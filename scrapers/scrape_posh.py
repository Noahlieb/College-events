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


def scrape_explore(url: str, headless: bool = True, debug_dir: Path | None = None, debug_label: str = "explore") -> list[dict]:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(user_agent=USER_AGENT)
        response = page.goto(url, wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_selector(".EventCard", timeout=30000)
        except Exception:
            pass
        cards = page.evaluate(CARD_EXTRACT_JS)
        if not cards:
            status = response.status if response else "?"
            title = page.title()
            print(f"  0 cards found (HTTP {status}, page title: {title!r})", file=sys.stderr)
            # Zero cards is either a real empty result or a bot-detection wall
            # (CAPTCHA/challenge page) -- a screenshot + the raw HTML settles
            # which one happened without needing to reproduce it by hand.
            if debug_dir:
                debug_dir.mkdir(parents=True, exist_ok=True)
                safe = slugify(debug_label)
                try:
                    page.screenshot(path=str(debug_dir / f"{safe}.png"), full_page=True)
                    (debug_dir / f"{safe}.html").write_text(page.content(), encoding="utf-8")
                    print(f"  saved debug screenshot/html to {debug_dir}/{safe}.*", file=sys.stderr)
                except Exception as e:
                    print(f"  debug capture failed: {e}", file=sys.stderr)
        browser.close()
        return cards


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
    args = parser.parse_args()
    headless = not args.headed
    debug_dir = Path(args.out_dir) / "debug"

    if args.url:
        rows = scrape_one("adhoc", args.url, headless, args.no_detail, args.delay, debug_dir=debug_dir)
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
    for school in schools:
        rows = []
        seen_urls = set()
        for url in school["urls"]:
            for row in scrape_one(school["school"], url, headless, args.no_detail, args.delay, debug_dir=debug_dir):
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
        if not rows:
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


if __name__ == "__main__":
    main()
