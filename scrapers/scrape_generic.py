#!/usr/bin/env python3
"""Scrape events from an arbitrary school events page into a
College-events-ready import CSV -- no vendor-specific config needed.

scrape_owlcentral.py and scrape_posh.py each hardcode one vendor's API/DOM
shape. This script is the fallback for schools whose platform isn't either
of those (e.g. CampusGroups, Presence, a homegrown calendar): point it at
one events page URL and it tries, in order, whichever of these actually
finds real events:

  1. Find and parse a public iCalendar (.ics) feed -- RFC 5545, the same
     structured format packages/ingestion/src/ical.ts already treats as
     the preferred source over HTML scraping. Pass an .ics URL directly
     and this skips the browser entirely; given a regular events page, it
     also scans the rendered HTML for any embedded .ics URL (most campus
     calendar platforms -- Engage included, per ical.ts's own comment --
     expose a "subscribe to calendar" link even when the page itself is a
     scraping-hostile SPA) and uses that when found.
  2. Render the page in a real browser and sniff every XHR/fetch response
     for JSON -- most modern event sites are single-page apps that load
     their listing from their own internal API, and that response is
     almost always a list of dicts that share a name-like key and a
     date-like key. This is what a human would find by opening DevTools'
     Network tab and looking for the request that returns the event list;
     this automates that search rather than hardcoding one site's endpoint.
  3. Parse schema.org Event structured data (<script type="application/
     ld+json">) out of the rendered page. This is the same JSON-LD format
     scrape_posh.py already trusts as its primary source on posh.vip's own
     /e/ detail pages -- many event platforms emit it for SEO regardless
     of how the page itself renders.

All three are best-effort: field names vary site to site, so extraction
matches against a list of common aliases (see NAME_KEYS / START_KEYS /
etc. below) rather than one fixed schema. Run with --diagnose to see what
each strategy found (and why) without needing a successful match first --
essential for tuning this against a new site, since there's no single API
contract to verify against ahead of time the way there is for
scrape_owlcentral.py.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

import certifi
from playwright.sync_api import sync_playwright

try:
    from dateutil import parser as dateutil_parser
except ImportError:  # pragma: no cover - guarded, see requirements.txt
    dateutil_parser = None

SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
EASTERN = ZoneInfo("America/New_York")
NAV_TIMEOUT_MS = 45000
SCROLL_STEPS = 6
SCROLL_PAUSE_MS = 700

RAW_FIELDNAMES = ["id", "name", "organization", "starts_on", "ends_on", "location",
                   "description", "url", "image_url", "found_via"]
COLLEGE_EVENTS_FIELDNAMES = ["Date", "Time (ET)", "Event", "Category", "Presenter/Team", "Venue", "Notes", "Image URL", "Link"]

# Key names are matched after stripping everything but letters/digits and
# lowercasing, so "startDate", "start_date", "StartsOn", and "starts-on" all
# match the same alias below.
NAME_KEYS = {"name", "title", "eventname", "eventtitle", "subject", "headline"}
START_KEYS = {"startdate", "startson", "start", "starttime", "begin", "begindate",
              "dtstart", "date", "eventdate", "eventstart", "startdatetime"}
END_KEYS = {"enddate", "endson", "end", "endtime", "dtend", "eventend", "enddatetime"}
LOCATION_KEYS = {"location", "venue", "place", "room", "address", "locationname", "roomname"}
DESC_KEYS = {"description", "summary", "details", "body", "abstract"}
URL_KEYS = {"url", "link", "permalink", "eventurl", "slug", "href", "detailurl", "canonicalurl"}
IMAGE_KEYS = {"image", "imageurl", "thumbnail", "thumbnailurl", "photo", "picture",
              "imagepath", "coverimage", "bannerimage"}
ORG_KEYS = {"organization", "organizer", "org", "host", "group", "club", "presenter",
            "sponsor", "organizationname", "hostname", "hostorg"}
ID_KEYS = {"id", "eventid", "uuid", "guid", "pk"}
# Some APIs nest the real fields one level down under a wrapper -- JSON:API's
# "attributes"/"data", GraphQL's "node", Airtable/CMS-style "fields".
WRAPPER_KEYS = ("fields", "attributes", "data", "node")

# Matches a bare .ics URL embedded anywhere in a page's HTML/inline JS --
# e.g. CampusGroups' "subscribe to calendar" feature builds one as a plain
# string literal (`return "https://school.edu/ical/x/feed.ics"`) rather than
# fetching it via XHR, so it never shows up in the network sniff and has to
# be found by scanning the page source text directly.
ICS_URL_RE = re.compile(r'https?://[^\s"\'<>\\]+\.ics(?:\?[^\s"\'<>\\]*)?', re.IGNORECASE)


def _norm_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(k).lower())


class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def get_text(self):
        return "".join(self.parts)


def strip_html(html) -> str:
    if not html:
        return ""
    stripper = _HTMLStripper()
    try:
        stripper.feed(html)
    except Exception:
        return re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", stripper.get_text()).strip()


class _JsonLdCollector(HTMLParser):
    """Pulls the raw text out of every <script type="application/ld+json">
    tag. Not layered on an HTML tree parser (no such thing in stdlib) --
    HTMLParser's start/end tag callbacks are enough to bracket each script
    body, and the JSON itself is decoded separately once we have the text."""

    def __init__(self):
        super().__init__()
        self._in_ldjson = False
        self._chunks: list[str] = []
        self.blocks: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("type", "").lower() == "application/ld+json":
            self._in_ldjson = True
            self._chunks = []

    def handle_data(self, data):
        if self._in_ldjson:
            self._chunks.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._in_ldjson:
            self.blocks.append("".join(self._chunks))
            self._in_ldjson = False


def extract_jsonld_events(html: str) -> list[dict]:
    collector = _JsonLdCollector()
    try:
        collector.feed(html)
    except Exception:
        pass

    def flatten(node, out):
        if isinstance(node, list):
            for n in node:
                flatten(n, out)
        elif isinstance(node, dict):
            types = node.get("@type")
            types = types if isinstance(types, list) else [types]
            if any(isinstance(t, str) and t.lower() == "event" for t in types):
                out.append(node)
            if "@graph" in node:
                flatten(node["@graph"], out)

    events: list[dict] = []
    for block in collector.blocks:
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        flatten(data, events)
    return events


def first_image(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get("url") or value.get("src") or value.get("href") or ""
    if isinstance(value, list) and value:
        return first_image(value[0])
    return ""


def map_jsonld_event(ev: dict, base_url: str) -> dict:
    name = (ev.get("name") or "").strip()

    location = ev.get("location")
    location_str = ""
    if isinstance(location, dict):
        location_str = location.get("name") or ""
        addr = location.get("address")
        if isinstance(addr, dict):
            addr_str = ", ".join(filter(None, [
                addr.get("streetAddress"), addr.get("addressLocality"), addr.get("addressRegion"),
            ]))
        elif isinstance(addr, str):
            addr_str = addr
        else:
            addr_str = ""
        if addr_str:
            location_str = f"{location_str} ({addr_str})" if location_str else addr_str
    elif isinstance(location, str):
        location_str = location

    organizer = ev.get("organizer")
    org_name = organizer.get("name") if isinstance(organizer, dict) else (organizer or "")

    url = ev.get("url") or ""
    if url:
        url = urllib.parse.urljoin(base_url, url)

    return {
        "id": ev.get("identifier") or "",
        "name": name,
        "organization": (org_name or "").strip(),
        "starts_on": ev.get("startDate"),
        "ends_on": ev.get("endDate"),
        "location": location_str,
        "description": strip_html(ev.get("description") or ""),
        "url": url,
        "image_url": first_image(ev.get("image")),
        "found_via": "jsonld",
    }


def fetch_text(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"Accept": "text/calendar, text/plain", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_ics(text: str) -> list[dict]:
    """Minimal RFC 5545 VEVENT parser -- a Python port of
    packages/ingestion/src/ical.ts's parseIcs, kept dependency-free the same
    way and for the same reason: ICS is simple enough that a small parser is
    easier to reason about than pulling in a library for it."""
    unfolded = text.replace("\r\n", "\n").replace("\n ", "").replace("\n\t", "")  # RFC5545 line unfolding
    lines = [ln for ln in unfolded.split("\n") if ln]

    events: list[dict] = []
    current: dict | None = None
    for line in lines:
        if line.startswith("BEGIN:VEVENT"):
            current = {}
            continue
        if line.startswith("END:VEVENT"):
            if current is not None:
                events.append(current)
            current = None
            continue
        if current is None:
            continue

        sep = line.find(":")
        if sep == -1:
            continue
        raw_key = line[:sep]
        value = line[sep + 1:].strip()
        key = raw_key.split(";")[0].upper()  # strip params like ;TZID=...

        if key == "UID":
            current["uid"] = value
        elif key == "SUMMARY":
            current["summary"] = _unescape_ics_text(value)
        elif key == "DESCRIPTION":
            current["description"] = _unescape_ics_text(value)
        elif key == "LOCATION":
            current["location"] = _unescape_ics_text(value)
        elif key == "URL":
            current["url"] = value
        elif key == "DTSTART":
            current["dtstart"] = value
        elif key == "DTEND":
            current["dtend"] = value
    return events


def _unescape_ics_text(value: str) -> str:
    return value.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def ics_date_to_iso(value: str | None) -> str | None:
    """Converts an ICS DTSTART/DTEND value ("20260826T180000Z" or "20260826")
    to ISO 8601, mirroring packages/ingestion/src/ical.ts's icsDateToIso."""
    if not value:
        return None
    m = re.match(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$", value)
    if m:
        y, mo, d, h, mi, s = m.groups()
        return f"{y}-{mo}-{d}T{h}:{mi}:{s}.000Z"
    m = re.match(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$", value)
    if m:
        y, mo, d, h, mi, s = m.groups()
        # No explicit offset/TZID -- treated as already-Eastern, same
        # assumption parse_when() makes for any other naive timestamp.
        return f"{y}-{mo}-{d}T{h}:{mi}:{s}"
    m = re.match(r"^(\d{4})(\d{2})(\d{2})$", value)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{mo}-{d}T00:00:00"
    return None


def map_ics_event(ev: dict, source_url: str) -> dict:
    return {
        "id": ev.get("uid") or "",
        "name": (ev.get("summary") or "").strip(),
        "organization": "",
        "starts_on": ics_date_to_iso(ev.get("dtstart")),
        "ends_on": ics_date_to_iso(ev.get("dtend")),
        "location": (ev.get("location") or "").strip(),
        "description": ev.get("description") or "",
        "url": ev.get("url") or source_url,
        "image_url": "",
        "found_via": "ics",
    }


def find_ics_urls(html: str) -> list[str]:
    seen = []
    for m in ICS_URL_RE.finditer(html):
        url = m.group(0)
        if url not in seen:
            seen.append(url)
    return seen


def scrape_ics(url: str) -> list[dict]:
    text = fetch_text(url)
    return [map_ics_event(ev, url) for ev in parse_ics(text)]


_META_TAG_RE = re.compile(r"<meta\s+[^>]*>", re.IGNORECASE)
_META_IMAGE_NAME_RE = re.compile(r'(?:property|name)\s*=\s*["\'](?:og:image|twitter:image)["\']', re.IGNORECASE)
_META_CONTENT_RE = re.compile(r'content\s*=\s*["\']([^"\']*)["\']', re.IGNORECASE)


def _extract_og_image(html: str) -> str | None:
    """og:image (or its twitter:image fallback) is how a page declares its
    own preview image for link unfurls (Slack, iMessage, social) --
    virtually universal regardless of platform, which makes it a far more
    reliable generic signal than reverse-engineering one vendor's card
    markup. Matches the whole <meta> tag first so attribute order (content
    before or after property/name) doesn't matter."""
    for tag in _META_TAG_RE.findall(html):
        if _META_IMAGE_NAME_RE.search(tag):
            m = _META_CONTENT_RE.search(tag)
            if m and m.group(1):
                return m.group(1)
    return None


def fetch_page_image(url: str, timeout: int = 15) -> str | None:
    req = urllib.request.Request(url, headers={"Accept": "text/html", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
            # og:image lives in <head>, at the top of the document -- no
            # need to read a potentially large page in full.
            html = resp.read(800_000).decode("utf-8", errors="replace")
    except Exception:
        return None
    return _extract_og_image(html)


def backfill_missing_images(events: list[dict], source_url: str, delay: float = 0.15) -> int:
    """Fetches each event's own page to fill in image_url where a source
    (an .ics feed, especially -- RFC 5545 has no image field at all)
    supplied none. Skips anything that isn't really a per-event link:
    `source_url` itself (map_ics_event falls back to the feed URL when a
    VEVENT has no URL of its own -- fetching that would just find the
    feed's own page, if any, misattributed to every event that hit the
    fallback) and any other `.ics` URL. Caches by URL so events that
    share one link -- including that fallback case -- are only fetched
    once rather than once per event."""
    cache: dict[str, str | None] = {}
    filled = 0
    for row in events:
        if row.get("image_url"):
            continue
        url = row.get("url")
        if not url or url == source_url or url.lower().split("?")[0].endswith(".ics"):
            continue
        if url not in cache:
            cache[url] = fetch_page_image(url)
            time.sleep(delay)
        if cache[url]:
            row["image_url"] = cache[url]
            filled += 1
    return filled


def _find_field(item: dict, keys: set) -> tuple[str, object] | None:
    for k, v in item.items():
        if _norm_key(k) in keys:
            return k, v
    return None


def _unwrap(item: dict) -> list[dict]:
    candidates = [item]
    for wk in WRAPPER_KEYS:
        wv = item.get(wk)
        if isinstance(wv, dict):
            candidates.append(wv)
    return candidates


def _get(item: dict, keys: set):
    for cand in _unwrap(item):
        found = _find_field(cand, keys)
        if found is not None:
            return found[1]
    return None


def _datetime_value(v) -> str | None:
    """Coerces whatever shape a date field came in (a plain ISO string, a
    {"dateTime": "..."} wrapper some calendar APIs use, or a Unix
    timestamp) down to a string parse_when() can take a pass at."""
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        for k, v2 in v.items():
            if _norm_key(k) in {"datetime", "iso", "value", "date", "utc"} and isinstance(v2, str):
                return v2
        return None
    if isinstance(v, (int, float)):
        try:
            if v > 10**12:
                return datetime.fromtimestamp(v / 1000, tz=timezone.utc).isoformat()
            if v > 10**9:
                return datetime.fromtimestamp(v, tz=timezone.utc).isoformat()
        except (ValueError, OSError, OverflowError):
            return None
    return None


def score_array(arr: list) -> int:
    """How many items in this array look like events -- have both a
    name-like field and a date-like field. Used to pick, among every array
    found anywhere in every captured JSON response, the one that's actually
    the event list rather than a nav menu, a filter list, or pagination
    metadata that happens to also be an array of dicts."""
    score = 0
    for item in arr:
        if not isinstance(item, dict):
            continue
        if any(_find_field(cand, NAME_KEYS) and _find_field(cand, START_KEYS) for cand in _unwrap(item)):
            score += 1
    return score


def iter_candidate_arrays(obj, depth: int = 0, max_depth: int = 6):
    if depth > max_depth:
        return
    if isinstance(obj, list):
        if obj and all(isinstance(it, dict) for it in obj):
            yield obj
        for it in obj:
            yield from iter_candidate_arrays(it, depth + 1, max_depth)
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from iter_candidate_arrays(v, depth + 1, max_depth)


def map_generic_item(item: dict, base_url: str) -> dict:
    name = _get(item, NAME_KEYS) or ""
    location = _get(item, LOCATION_KEYS)
    if isinstance(location, dict):
        location = location.get("name") or location.get("address") or ""
    org = _get(item, ORG_KEYS)
    if isinstance(org, dict):
        org = org.get("name") or ""
    url_val = _get(item, URL_KEYS) or ""
    if isinstance(url_val, str) and url_val:
        url_val = urllib.parse.urljoin(base_url, url_val)
    description = _get(item, DESC_KEYS)
    ident = _get(item, ID_KEYS)

    return {
        "id": ident if ident is not None else "",
        "name": str(name).strip(),
        "organization": str(org or "").strip(),
        "starts_on": _datetime_value(_get(item, START_KEYS)),
        "ends_on": _datetime_value(_get(item, END_KEYS)),
        "location": str(location or "").strip(),
        "description": strip_html(description) if isinstance(description, str) else "",
        "url": url_val if isinstance(url_val, str) else "",
        "image_url": first_image(_get(item, IMAGE_KEYS)),
        "found_via": "network-json",
    }


def parse_when(raw) -> datetime | None:
    """Best-effort parse of whatever date string a site handed back.
    Real ISO-8601 (what schema.org's startDate is supposed to be, and what
    most JSON APIs actually send) parses directly; anything looser (a
    server-rendered "August 31, 2026 7:00 PM") falls to dateutil, which
    handles far more formats than the stdlib does. A naive result is
    assumed to already be Eastern -- every source this script targets is a
    single-campus site with no reason to localize to anything else."""
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=EASTERN)
    except ValueError:
        pass
    if dateutil_parser is not None:
        try:
            dt = dateutil_parser.parse(s)
            return dt if dt.tzinfo else dt.replace(tzinfo=EASTERN)
        except (ValueError, OverflowError, TypeError):
            return None
    return None


def to_college_events_row(row: dict) -> dict | None:
    dt_start = parse_when(row.get("starts_on"))
    if not dt_start or not row.get("name"):
        return None
    dt_start_et = dt_start.astimezone(EASTERN)
    dt_end = parse_when(row.get("ends_on"))

    start_time = dt_start_et.strftime("%I:%M %p").lstrip("0")
    end_time = dt_end.astimezone(EASTERN).strftime("%I:%M %p").lstrip("0") if dt_end else None
    time_field = f"{start_time}-{end_time}" if end_time else start_time

    return {
        "Date": dt_start_et.strftime("%Y-%m-%d"),
        "Time (ET)": time_field,
        "Event": row["name"],
        "Category": "other",
        "Presenter/Team": row.get("organization") or "",
        "Venue": row.get("location") or "",
        "Notes": row.get("description") or "",
        "Image URL": row.get("image_url") or "",
        "Link": row.get("url") or "",
    }


def _dedupe_key(row: dict) -> tuple:
    return (row.get("name", "").strip().lower(), str(row.get("starts_on")), row.get("url", ""))


def filter_by_window(events: list[dict], days_ahead: int) -> tuple[list[dict], int]:
    """Keeps only events starting within the next `days_ahead` days.

    A subscribe-to-calendar .ics feed (unlike Engage's own discovery API,
    which scrape_owlcentral.py already bounds with an endsAfter/startsBefore
    query) has no date range of its own -- it's typically the whole
    semester or year, past events included. Without this, USF's feed alone
    returned 4,654 events for one school. Returns (kept, dropped_count);
    an event with no parseable start date is dropped too, since there's no
    way to know if it's in the window."""
    if days_ahead <= 0:
        return events, 0
    now = datetime.now(timezone.utc)
    until = now + timedelta(days=days_ahead)
    kept = []
    for row in events:
        dt = parse_when(row.get("starts_on"))
        if dt and now <= dt.astimezone(timezone.utc) <= until:
            kept.append(row)
    return kept, len(events) - len(kept)


def _save_diagnostics(debug_dir: Path, label: str, html: str, captured: list[tuple[str, object]]) -> None:
    debug_dir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "page"
    (debug_dir / f"{safe}.html").write_text(html, encoding="utf-8")
    summary = []
    for src_url, data in captured:
        for arr in iter_candidate_arrays(data):
            summary.append({
                "response_url": src_url,
                "array_length": len(arr),
                "score": score_array(arr),
                "sample_keys": sorted({k for it in arr[:3] if isinstance(it, dict) for k in it.keys()}),
            })
    (debug_dir / f"{safe}_json_candidates.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"  saved diagnostics to {debug_dir}/{safe}.html and {safe}_json_candidates.json", file=sys.stderr)


def scrape_url(url: str, headless: bool = True, scroll_steps: int = SCROLL_STEPS,
                debug_dir: Path | None = None, debug_label: str = "page") -> list[dict]:
    captured: list[tuple[str, object]] = []

    def on_response(response):
        try:
            if "json" not in (response.headers.get("content-type") or "").lower():
                return
            if response.request.resource_type not in ("xhr", "fetch"):
                return
            captured.append((response.url, response.json()))
        except Exception:
            pass

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(user_agent=USER_AGENT)
        page.on("response", on_response)
        try:
            page.goto(url, wait_until="networkidle", timeout=NAV_TIMEOUT_MS)
        except Exception:
            page.goto(url, wait_until="load", timeout=NAV_TIMEOUT_MS)

        for _ in range(scroll_steps):
            try:
                page.mouse.wheel(0, 2000)
                page.wait_for_timeout(SCROLL_PAUSE_MS)
            except Exception:
                break

        html = page.content()
        final_url = page.url
        if debug_dir:
            _save_diagnostics(debug_dir, debug_label, html, captured)
        browser.close()

    events: list[dict] = []
    seen = set()

    ics_urls = find_ics_urls(html)
    ics_used = 0
    for ics_url in ics_urls:
        try:
            for row in scrape_ics(ics_url):
                key = _dedupe_key(row)
                if row["name"] and key not in seen:
                    seen.add(key)
                    events.append(row)
                    ics_used += 1
        except Exception as e:
            print(f"  found .ics link {ics_url} but couldn't fetch/parse it: {e}", file=sys.stderr)
    if ics_urls:
        print(f"  .ics discovery: found {ics_urls}, {ics_used} usable event(s)", file=sys.stderr)
    else:
        print("  .ics discovery: no .ics URL found in the page", file=sys.stderr)

    jsonld_events = extract_jsonld_events(html)
    jsonld_used = 0
    for ev in jsonld_events:
        row = map_jsonld_event(ev, final_url)
        key = _dedupe_key(row)
        if row["name"] and key not in seen:
            seen.add(key)
            events.append(row)
            jsonld_used += 1
    print(f"  schema.org JSON-LD: {len(jsonld_events)} Event block(s) found, {jsonld_used} usable", file=sys.stderr)

    best_array, best_score, best_src = None, 0, None
    for src_url, data in captured:
        for arr in iter_candidate_arrays(data):
            score = score_array(arr)
            if score > best_score:
                best_array, best_score, best_src = arr, score, src_url

    net_used = 0
    if best_array is not None and best_score >= 2 and best_score >= 0.5 * len(best_array):
        for item in best_array:
            if not isinstance(item, dict):
                continue
            row = map_generic_item(item, final_url)
            key = _dedupe_key(row)
            if row["name"] and key not in seen:
                seen.add(key)
                events.append(row)
                net_used += 1
        print(
            f"  network sniff: best array from {best_src} scored {best_score}/{len(best_array)}, {net_used} usable",
            file=sys.stderr,
        )
    else:
        print(f"  network sniff: no event-shaped JSON array found across {len(captured)} captured response(s)", file=sys.stderr)

    return events


def save_raw_csv(events: list[dict], path: Path) -> int:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=RAW_FIELDNAMES)
        writer.writeheader()
        writer.writerows(events)
    return len(events)


def save_college_events_csv(events: list[dict], path: Path) -> int:
    converted = [c for c in (to_college_events_row(e) for e in events) if c is not None]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLLEGE_EVENTS_FIELDNAMES)
        writer.writeheader()
        writer.writerows(converted)
    return len(converted)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape events from an arbitrary school events page (no vendor-specific config needed)."
    )
    parser.add_argument("--url", required=True, help="the events page to scrape")
    parser.add_argument("--school", required=True, help="school short name, used to name the output files")
    parser.add_argument("--out-dir", default=str(Path.home() / "Downloads"), help="directory for output CSVs (default: ~/Downloads)")
    parser.add_argument("--headed", action="store_true", help="show the browser window (debugging)")
    parser.add_argument("--scroll-steps", type=int, default=SCROLL_STEPS, help="how many scroll attempts to trigger lazy-loaded listings")
    parser.add_argument("--days-ahead", type=int, default=60,
                         help="only keep events starting within N days from now (default: 60; 0 disables filtering -- "
                         "a raw .ics feed has no date range of its own and can include years of past events)")
    parser.add_argument(
        "--diagnose",
        action="store_true",
        help="save the rendered HTML and a summary of every JSON array the network sniff considered, "
        "without requiring a successful match first -- for tuning this against a new site",
    )
    parser.add_argument(
        "--no-image-backfill",
        action="store_true",
        help="skip fetching each event's own page to fill in a missing image_url via its og:image meta tag "
        "(faster, but sources with no image field of their own -- .ics feeds especially -- come back with none)",
    )
    args = parser.parse_args()
    headless = not args.headed

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    debug_dir = (out_dir / "debug") if args.diagnose else None
    school_lower = args.school.lower()

    url_path = urllib.parse.urlparse(args.url).path.lower()
    if url_path.endswith(".ics"):
        # A direct feed URL needs no browser at all -- plain HTTP GET + parse.
        print(f"Loading {args.school}: {args.url} (.ics feed) ...", file=sys.stderr)
        events = scrape_ics(args.url)
    else:
        print(f"Loading {args.school}: {args.url} ...", file=sys.stderr)
        events = scrape_url(args.url, headless=headless, scroll_steps=args.scroll_steps,
                             debug_dir=debug_dir, debug_label=school_lower)
    print(f"  found {len(events)} event(s) total.", file=sys.stderr)

    events, dropped = filter_by_window(events, args.days_ahead)
    if args.days_ahead > 0:
        print(f"  kept {len(events)} within the next {args.days_ahead}d ({dropped} outside the window or undated)", file=sys.stderr)

    if not events:
        print(
            "  no events found. Re-run with --diagnose to see what the network sniff saw, "
            "and --headed to watch the page load.",
            file=sys.stderr,
        )
        return

    if not args.no_image_backfill:
        missing_before = sum(1 for e in events if not e.get("image_url"))
        if missing_before:
            filled = backfill_missing_images(events, args.url)
            print(f"  image backfill: filled {filled}/{missing_before} missing image_url(s) via each event's own page", file=sys.stderr)

    raw_path = out_dir / f"generic_events_{school_lower}.csv"
    raw_count = save_raw_csv(events, raw_path)
    print(f"  saved {raw_count} events to {raw_path}", file=sys.stderr)

    ce_path = out_dir / f"college_events_import_{school_lower}_generic.csv"
    ce_count = save_college_events_csv(events, ce_path)
    print(f"  wrote {ce_count} College-events-ready rows to {ce_path}", file=sys.stderr)
    if ce_count < raw_count:
        print(
            f"  note: {raw_count - ce_count} event(s) dropped from the import CSV -- no name or no "
            "parseable start date. Check the raw CSV's starts_on column for what the date actually looked like.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
