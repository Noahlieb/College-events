#!/usr/bin/env python3
"""Scrape event listings from posh.vip/explore into a CSV, per school.

Two stages:
  1. Render /explore in a headless browser (event data loads client-side via
     JS, so a plain HTTP request can't see it) and pull title/date/venue/image
     off each .EventCard.
  2. For each event's slug, plain HTTP GET its /e/<slug> page and extract the
     full schema.org/Event JSON-LD Next.js embeds there (richer description,
     structured venue address, canonical image) -- no browser needed for this
     part since the data is already in the server-rendered HTML.

Both stages only touch /explore and /e/ paths, which posh.vip's robots.txt
explicitly allows for a generic user agent.

By default, scrapes every school listed in schools.json (one or more
posh.vip /explore locations per school, merged and deduped) and writes
posh_events_<school>.csv per school.
Pass --url for a one-off scrape of a single location instead.
"""
import argparse
import csv
import json
import re
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import certifi
from playwright.sync_api import sync_playwright

SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

DEFAULT_CONFIG_PATH = Path(__file__).parent / "schools.json"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

CARD_EXTRACT_JS = r"""
() => {
  function findSlug(el) {
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;
    let fiber = el[fiberKey];
    for (let i = 0; fiber && i < 15; i++, fiber = fiber.return) {
      const p = fiber.memoizedProps;
      if (p && typeof p.url === 'string' && p.name) return p.url;
    }
    return null;
  }
  return Array.from(document.querySelectorAll('.EventCard')).map(card => {
    const style = card.getAttribute('style') || '';
    const m = style.match(/url\(&quot;(.*?)&quot;\)/) || style.match(/url\("?(.*?)"?\)/);
    const nameEl = card.querySelector('.EventCard-name');
    const dateEl = card.querySelector('.EventCard-date');
    const locEl = card.querySelector('.EventCard-location');
    const orgImg = card.querySelector('.EventCard-organizer');
    return {
      name: nameEl ? nameEl.textContent.trim() : null,
      date_text: dateEl ? dateEl.textContent.trim() : null,
      venue: locEl ? locEl.textContent.trim() : null,
      image_url: m ? m[1] : null,
      organizer_image_url: orgImg ? orgImg.getAttribute('src') : null,
      slug: findSlug(card),
    };
  });
}
"""


class BrowserClosed(RuntimeError):
    """The browser window went away mid-scrape -- almost always a human closing
    it. Worth its own error so the run ends with one clear line instead of a
    Playwright traceback."""


DIAGNOSE_JS = r"""
() => {
  const counts = {};
  for (const el of document.querySelectorAll('*')) {
    const cls = typeof el.className === 'string' ? el.className : '';
    for (const c of cls.split(/\s+/)) if (c) counts[c] = (counts[c] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return {
    title: document.title,
    eventCardCount: document.querySelectorAll('.EventCard').length,
    totalElements: document.querySelectorAll('*').length,
    looksRelevant: entries.filter(([c]) => /event|card|tile|listing|item/i.test(c)).slice(0, 30),
    topClasses: entries.slice(0, 25),
    linkSample: Array.from(document.querySelectorAll('a[href*="/e/"]')).slice(0, 8).map(a => a.getAttribute('href')),
  };
}
"""


class CloudflareChallenge(RuntimeError):
    """posh.vip served Cloudflare's bot-management challenge instead of the
    listings. Raised so callers can report *why* a location produced nothing,
    rather than reporting an empty result that reads like a quiet failure."""


# How long to wait for the listings to appear. Headed runs get much longer
# because a human may need to clear a challenge by hand; headless runs get the
# original timeout, since nobody is there to intervene.
CONTENT_TIMEOUT_MS = 30000
HEADED_CONTENT_TIMEOUT_MS = 180000


def _looks_like_challenge(page) -> bool:
    """Whether the browser is sitting on Cloudflare's interstitial.

    Only consulted once the listings have failed to appear, to explain why.
    It deliberately does NOT test for `window._cf_chl_opt`: Cloudflare leaves
    that defined on normal pages too, so keying off it reports a challenge on
    a page that loaded perfectly well."""
    try:
        if "just a moment" in (page.title() or "").lower():
            return True
        return bool(
            page.evaluate(
                "() => Boolean(document.querySelector('[id^=cf-chl-widget]')"
                " || document.querySelector('#challenge-error-text'))"
            )
        )
    except Exception:
        return False


def _capture_debug(page, debug_dir: Path | None, label: str) -> None:
    """Saves a screenshot + the raw HTML of whatever the browser actually got.
    A challenge page and a genuinely empty listing look identical in the logs;
    the capture is what tells them apart after the fact."""
    if not debug_dir:
        return
    debug_dir.mkdir(parents=True, exist_ok=True)
    safe = slugify(label)
    try:
        page.screenshot(path=str(debug_dir / f"{safe}.png"), full_page=True)
        (debug_dir / f"{safe}.html").write_text(page.content(), encoding="utf-8")
        print(f"  saved debug screenshot/html to {debug_dir}/{safe}.*", file=sys.stderr)
    except Exception as e:
        print(f"  debug capture failed: {e}", file=sys.stderr)


def scrape_explore(url: str, headless: bool = True, debug_dir: Path | None = None, debug_label: str = "explore") -> list[dict]:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(user_agent=USER_AGENT)
        try:
            response = page.goto(url, wait_until="domcontentloaded", timeout=60000)

            # Success is the listings showing up -- nothing else. Waiting on the
            # content directly means a challenge that clears (on its own, or
            # because a human solved it in a headed run) just continues into a
            # normal scrape, with no separate "are we challenged?" state to get
            # wrong.
            timeout = CONTENT_TIMEOUT_MS if headless else HEADED_CONTENT_TIMEOUT_MS
            if not headless:
                print(
                    f"  Waiting up to {timeout // 1000}s for listings — if a challenge appears, solve it in the browser.",
                    file=sys.stderr,
                )
            try:
                page.wait_for_selector(".EventCard", timeout=timeout)
            except Exception:
                pass

            try:
                cards = page.evaluate(CARD_EXTRACT_JS)
            except Exception as e:
                if page.is_closed() or "has been closed" in str(e):
                    raise BrowserClosed(
                        "the browser window was closed before the scrape finished"
                    ) from None
                raise

            if not cards:
                _capture_debug(page, debug_dir, debug_label)
                # The listings never matched .EventCard. Say what IS on the page
                # so a renamed class shows up here instead of needing a manual
                # dig through the captured HTML.
                try:
                    info = page.evaluate(DIAGNOSE_JS)
                    print(
                        f"  page had {info['totalElements']} elements; classes that look like listings: "
                        f"{[c for c, _ in info['looksRelevant'][:12]] or 'none'}",
                        file=sys.stderr,
                    )
                    if info["linkSample"]:
                        print(f"  found {len(info['linkSample'])} /e/ event links: {info['linkSample'][:3]}", file=sys.stderr)
                except Exception:
                    pass
                # Only now ask *why* there's no content, so a page that loaded
                # fine is never called blocked.
                if _looks_like_challenge(page):
                    raise CloudflareChallenge(
                        "posh.vip served a Cloudflare bot-management challenge instead of the listings"
                    )
                status = response.status if response else "?"
                print(f"  0 cards found (HTTP {status}, page title: {page.title()!r})", file=sys.stderr)
            return cards
        finally:
            browser.close()


FLIGHT_PUSH = re.compile(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)')


def fetch_event_detail(slug: str, timeout: int = 20) -> dict | None:
    """Fetch an event's page over plain HTTP and pull its schema.org/Event
    JSON-LD out of Next.js's RSC stream (it isn't a literal <script> tag).

    Next.js splits large flight strings across multiple push() calls with no
    per-chunk marker, so individual chunks can't be parsed in isolation --
    every chunk is unescaped and concatenated in document order first, then
    the JSON object is located by scanning for "@context" and letting
    json.JSONDecoder.raw_decode find its actual boundaries (ignoring any
    unrelated webpack-manifest data the chunk happens to be bundled with).
    """
    url = f"https://posh.vip/e/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  detail fetch failed for {slug}: {e}", file=sys.stderr)
        return None

    parts = []
    for raw in FLIGHT_PUSH.findall(html):
        try:
            parts.append(json.loads('"' + raw + '"'))
        except json.JSONDecodeError:
            parts.append("")
    combined = "".join(parts)

    decoder = json.JSONDecoder()
    idx = combined.find('"@context"')
    while idx != -1:
        brace_idx = combined.rfind("{", 0, idx)
        if brace_idx != -1:
            try:
                obj, _end = decoder.raw_decode(combined, brace_idx)
                if obj.get("@type") == "Event":
                    return obj
            except json.JSONDecodeError:
                pass
        idx = combined.find('"@context"', idx + 1)
    return None


def merge_event(card: dict, detail: dict | None, school: str) -> dict:
    detail = detail or {}
    location = detail.get("location") or {}
    address = location.get("address") or {}
    images = detail.get("image")
    detail_image = images[0] if isinstance(images, list) and images else None
    slug = card.get("slug")
    return {
        "school": school,
        "name": detail.get("name") or card.get("name"),
        "start_date": detail.get("startDate"),
        "end_date": detail.get("endDate"),
        "date_text": card.get("date_text"),
        "venue": location.get("name") or card.get("venue"),
        "address": address.get("streetAddress"),
        "organizer": (detail.get("organizer") or {}).get("name"),
        "description": detail.get("description"),
        "image_url": detail_image or card.get("image_url"),
        "event_url": detail.get("url") or (f"https://posh.vip/e/{slug}" if slug else None),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


FIELDNAMES = [
    "scraped_at", "school", "name", "start_date", "end_date", "date_text",
    "venue", "address", "organizer", "description", "image_url", "event_url",
]


def save_csv(rows: list[dict], path: Path) -> None:
    write_header = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


COLLEGE_EVENTS_FIELDNAMES = ["Date", "Time (ET)", "Event", "Category", "Presenter/Team", "Venue", "Notes", "Image URL", "Link"]

# US street addresses here are consistently "<street>, <city>, <ST> <ZIP>, USA"
# (posh.vip leaves schema.org's addressLocality field blank and crams
# everything into streetAddress instead), so the city is whatever sits right
# before the "ST ZIP" pair.
CITY_FROM_ADDRESS = re.compile(r",\s*([^,]+?),\s*[A-Z]{2}\s+\d{5}")


def _fmt_time(iso: str | None) -> str | None:
    if not iso:
        return None
    dt = datetime.fromisoformat(iso)
    return dt.strftime("%I:%M %p").lstrip("0")


def to_college_events_row(row: dict) -> dict | None:
    """Maps one row of our rich posh.vip data into the exact CSV shape
    College-events' import-csv command expects (see
    packages/ingestion/src/csv-events.ts). Rows without a resolved
    start_date (the JSON-LD detail fetch failed) are skipped -- the importer
    requires a parseable date/time and has no better fallback than ours."""
    if not row.get("start_date"):
        return None
    dt = datetime.fromisoformat(row["start_date"])
    start_time = _fmt_time(row["start_date"])
    end_time = _fmt_time(row.get("end_date"))
    time_field = f"{start_time}-{end_time}" if start_time and end_time else (start_time or "")

    city_match = CITY_FROM_ADDRESS.search(row.get("address") or "")
    venue = row.get("venue") or ""
    venue_field = f"{venue}, {city_match.group(1)}" if venue and city_match else venue

    return {
        "Date": dt.strftime("%Y-%m-%d"),
        "Time (ET)": time_field,
        "Event": row.get("name") or "",
        "Category": "Nightlife",
        "Presenter/Team": row.get("organizer") or "",
        "Venue": venue_field,
        "Notes": row.get("description") or "",
        "Image URL": row.get("image_url") or "",
        "Link": row.get("event_url") or "",
    }


def save_college_events_csv(rows: list[dict], path: Path) -> int:
    """Writes a fresh (non-appending) CSV in College-events' import-csv
    format -- each cron run overwrites this file with the current scrape,
    and re-importing it daily is safe because submitManualEvent's own
    dedup logic (name/date/venue matching) merges repeats instead of
    duplicating them."""
    converted = [c for c in (to_college_events_row(r) for r in rows) if c is not None]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLLEGE_EVENTS_FIELDNAMES)
        writer.writeheader()
        writer.writerows(converted)
    return len(converted)


def scrape_one(
    school: str, url: str, headless: bool, no_detail: bool, delay: float, debug_dir: Path | None = None
) -> list[dict]:
    print(f"Loading {school}: {url} ...", file=sys.stderr)
    cards = scrape_explore(url, headless=headless, debug_dir=debug_dir, debug_label=f"{school}_{url}")
    print(f"  found {len(cards)} event cards.", file=sys.stderr)

    rows = []
    for i, card in enumerate(cards):
        detail = None
        if not no_detail and card.get("slug"):
            detail = fetch_event_detail(card["slug"])
            time.sleep(delay)
        rows.append(merge_event(card, detail, school))
        print(f"  [{i + 1}/{len(cards)}] {rows[-1]['name']}", file=sys.stderr)
    return rows


DIAGNOSE_SETTLE_SECONDS = 15


def run_diagnostics(url: str, headless: bool, debug_dir: Path | None) -> None:
    """Loads one location and reports what's actually in the DOM.

    Exists because 'no events found' has several very different causes -- a
    challenge, a renamed class, an genuinely empty week -- and guessing between
    them from an empty CSV wastes a lot of time.
    """
    print(f"Loading {url}\n  (waiting {DIAGNOSE_SETTLE_SECONDS}s for the page to settle)", file=sys.stderr)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(user_agent=USER_AGENT)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(DIAGNOSE_SETTLE_SECONDS * 1000)
            info = page.evaluate(DIAGNOSE_JS)
            _capture_debug(page, debug_dir, "diagnose")
        except Exception as e:
            if page.is_closed() or "has been closed" in str(e):
                print("The browser window was closed before the check finished.", file=sys.stderr)
                sys.exit(3)
            raise
        finally:
            browser.close()

    print(f"\n  page title      : {info['title']!r}")
    print(f"  elements in DOM : {info['totalElements']}")
    print(f"  .EventCard count: {info['eventCardCount']}   <-- what this scraper looks for")
    print(f"  /e/ event links : {len(info['linkSample'])}")
    if info["linkSample"]:
        for href in info["linkSample"][:5]:
            print(f"      {href}")
    print("\n  classes that look like listings (name, count):")
    for c, n in info["looksRelevant"][:15] or [("(none found)", 0)]:
        print(f"      {c}  x{n}")
    print("\n  most common classes overall:")
    for c, n in info["topClasses"][:12]:
        print(f"      {c}  x{n}")

    if info["eventCardCount"] > 0:
        print("\n=> .EventCard still exists. The selector is fine; the problem is elsewhere.")
    elif "just a moment" in (info["title"] or "").lower():
        print("\n=> Cloudflare challenge page — the listings never loaded.")
    else:
        print("\n=> The page loaded but has no .EventCard. posh.vip most likely renamed its")
        print("   markup; the classes listed above are the candidates to switch to.")


def load_schools(config_path: Path) -> list[dict]:
    """Loads schools.json, normalising each entry to a `urls` list.

    A school can have several posh.vip location pages -- FAU students go out
    in both Boca Raton and Fort Lauderdale -- so an entry may carry either a
    single `url` or a list of `urls`. They are merged into one CSV per
    school rather than one per location: the per-school import CSV is
    written in "w" mode, so two entries sharing a school name would
    silently overwrite each other and quietly drop half the events.
    """
    with config_path.open() as f:
        schools = json.load(f)
    normalised = []
    for s in schools:
        if "school" not in s:
            raise ValueError(f"schools.json entry missing 'school': {s}")
        urls = s.get("urls") or ([s["url"]] if s.get("url") else [])
        if not urls:
            raise ValueError(f"schools.json entry for {s['school']} has no 'url' or 'urls': {s}")
        normalised.append({**s, "urls": urls})

    seen = {}
    for s in normalised:
        if s["school"] in seen:
            raise ValueError(
                f"schools.json lists '{s['school']}' more than once. Use a single entry with a "
                f"'urls' list instead -- separate entries overwrite each other's import CSV."
            )
        seen[s["school"]] = True
    return normalised


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape event listings from posh.vip/explore, per school.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="JSON file listing schools to scrape (default: schools.json)")
    parser.add_argument("--school", help="only scrape the school with this name in the config")
    parser.add_argument("--url", help="ad-hoc single posh.vip/explore URL, bypassing the config file")
    parser.add_argument("--out", help="output CSV path (only used together with --url)")
    parser.add_argument("--out-dir", default=str(Path(__file__).parent), help="directory for per-school CSVs")
    parser.add_argument("--headed", action="store_true", help="show the browser window (debugging)")
    parser.add_argument("--no-detail", action="store_true", help="skip per-event detail fetch (faster, less text)")
    parser.add_argument("--delay", type=float, default=0.5, help="seconds between per-event detail requests")
    parser.add_argument(
        "--diagnose",
        action="store_true",
        help="load the first location, report what markup the page actually has, and exit "
        "(for checking whether posh.vip renamed the classes this scraper looks for)",
    )
    args = parser.parse_args()
    headless = not args.headed
    debug_dir = Path(args.out_dir) / "debug"

    if args.diagnose:
        url = args.url
        if not url:
            config_path = Path(args.config)
            if not config_path.exists():
                print(f"No config at {config_path} and no --url given.", file=sys.stderr)
                sys.exit(1)
            url = load_schools(config_path)[0]["urls"][0]
        run_diagnostics(url, headless, debug_dir)
        return

    if args.url:
        try:
            rows = scrape_one("adhoc", args.url, headless, args.no_detail, args.delay, debug_dir=debug_dir)
        except CloudflareChallenge as e:
            # This is the manual/local path, so say what to do next rather than
            # dumping a traceback: --headed lets a human clear the challenge.
            print(
                f"BLOCKED: {e}.\nTry re-running with --headed and solving the challenge in the "
                "browser window that opens.",
                file=sys.stderr,
            )
            sys.exit(3)
        except BrowserClosed as e:
            print(f"Stopped: {e}.", file=sys.stderr)
            sys.exit(3)
        out_path = Path(args.out) if args.out else Path(args.out_dir) / "posh_events.csv"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        save_csv(rows, out_path)
        print(f"Saved {len(rows)} events to {out_path}", file=sys.stderr)
        ce_path = out_path.parent / "college_events_import_adhoc.csv"
        print(f"Wrote {save_college_events_csv(rows, ce_path)} College-events-ready rows to {ce_path}", file=sys.stderr)
        return

    config_path = Path(args.config)
    if not config_path.exists():
        print(
            f"No config file at {config_path}. Add entries like "
            '{"school": "FAU", "url": "https://posh.vip/explore?location=..."} '
            "to schools.json, or pass --url for a one-off scrape.",
            file=sys.stderr,
        )
        sys.exit(1)

    schools = load_schools(config_path)
    if args.school:
        schools = [s for s in schools if s["school"].lower() == args.school.lower()]
        if not schools:
            print(f"No school named '{args.school}' in {config_path}", file=sys.stderr)
            sys.exit(1)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    total = 0
    blocked_schools = []
    for school in schools:
        rows = []
        seen_urls = set()
        blocked_urls = []
        for url in school["urls"]:
            try:
                scraped = scrape_one(school["school"], url, headless, args.no_detail, args.delay, debug_dir=debug_dir)
            except CloudflareChallenge as e:
                # One location being challenged shouldn't discard another that
                # got through, so record it and keep going.
                print(f"  BLOCKED: {e}", file=sys.stderr)
                blocked_urls.append(url)
                continue
            for row in scraped:
                # Nearby locations overlap -- a Fort Lauderdale venue shows up
                # in the Boca feed too. Dedupe on the event's own page URL,
                # the only identifier posh.vip guarantees is stable.
                key = row.get("event_url")
                if key and key in seen_urls:
                    continue
                if key:
                    seen_urls.add(key)
                rows.append(row)
        if len(school["urls"]) > 1:
            print(f"  {school['school']}: {len(rows)} unique events across {len(school['urls'])} locations.", file=sys.stderr)
        if blocked_urls:
            blocked_schools.append((school["school"], len(blocked_urls), len(school["urls"])))
        if not rows:
            if blocked_urls:
                print(
                    f"  no events for {school['school']}: every location was blocked by Cloudflare.",
                    file=sys.stderr,
                )
            else:
                print(f"  no events found for {school['school']} -- the page layout may have changed.", file=sys.stderr)
            continue
        out_path = out_dir / f"posh_events_{slugify(school['school'])}.csv"
        save_csv(rows, out_path)
        print(f"  saved {len(rows)} events to {out_path}", file=sys.stderr)

        ce_path = out_dir / f"college_events_import_{slugify(school['school'])}.csv"
        ce_count = save_college_events_csv(rows, ce_path)
        print(f"  wrote {ce_count} College-events-ready rows to {ce_path}", file=sys.stderr)

        total += len(rows)

    print(f"Done. {total} events across {len(schools)} school(s).", file=sys.stderr)

    if blocked_schools:
        detail = ", ".join(f"{name} ({n}/{of} locations)" for name, n, of in blocked_schools)
        print(
            f"\nCloudflare blocked: {detail}.\n"
            "posh.vip runs bot management in front of /explore and challenges headless\n"
            "browsers regardless of network -- confirmed blocked from both CI runners and\n"
            "a residential connection. This is the site's deliberate access control, not a\n"
            "bug to route around. Re-run with --headed to solve the challenge yourself, or\n"
            "ask posh.vip for feed access. See scrapers/README.md.",
            file=sys.stderr,
        )
        # A marker the CI summary reads, so a blocked morning is reported as
        # blocked rather than as "0 events found".
        (out_dir / "posh-blocked.txt").write_text(detail + "\n", encoding="utf-8")
        # Non-zero so the step reads as failed in the Actions UI. The workflow
        # marks this step continue-on-error, so the rest of the pipeline still
        # runs on the sources that did work.
        sys.exit(3)


if __name__ == "__main__":
    main()
