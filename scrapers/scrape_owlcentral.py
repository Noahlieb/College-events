#!/usr/bin/env python3
"""Scrape FAU's Owl Central (Campus Labs Engage) events into a
College-events-ready import CSV.

Hits the public JSON API that backs https://fau.campuslabs.com/engage/events
(GET /engage/api/discovery/event/search) rather than parsing HTML or the
site's own events.ics feed -- the JSON API has no practical page-count cap,
carries richer per-event fields (theme, RSVP count, a real image), and lets
us bound the pull to a rolling upcoming window the same way scrape_posh.py
does for posh.vip.

Companion to scrape_posh.py / run_daily.sh: mirrors that script's dual output
(a raw CSV of everything scraped, plus a college_events_import_<school>.csv
in the exact shape apps/worker's `import-csv` command expects -- see
packages/ingestion/src/csv-events.ts) and the same run_daily-style wiring:

    cd College-events
    pnpm --filter @college-events/worker start import-csv FAU \\
      /Users/noah_lieb/posh-scraper/college_events_import_fau_owlcentral.csv \\
      owlcentral-scraper \\
      --source="Owl Central (CSV Import)"

That --source name must match a manual_submission-type source already
configured for FAU (Sources page or a DB seed) before import-csv will accept
rows -- it deliberately won't guess or auto-create one.
"""
import argparse
import csv
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

import certifi

SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

API_URL = "https://fau.campuslabs.com/engage/api/discovery/event/search"
EVENT_URL_TMPL = "https://fau.campuslabs.com/engage/event/{id}"
IMAGE_URL_TMPL = "https://se-images.campuslabs.com/clink/images/{path}?preset=large-sq"
USER_AGENT = "Mozilla/5.0 (compatible; owlcentral-scraper/1.0)"
PAGE_SIZE = 100
EASTERN = ZoneInfo("America/New_York")

RAW_FIELDNAMES = ["id", "name", "organization", "starts_on", "ends_on", "location",
                   "theme", "categories", "rsvp_total", "description", "url", "image_url"]
COLLEGE_EVENTS_FIELDNAMES = ["Date", "Time (ET)", "Event", "Category", "Presenter/Team", "Venue", "Notes", "Image URL", "Link"]

# Owl Central's own "theme" facets mapped onto College-events' EVENT_CATEGORIES
# (packages/core/src/types/enums.ts) / CATEGORY_ALIASES (csv-events.ts). Not
# an exact fit -- Owl Central's themes are broader than College-events'
# categories -- so this is a best-effort bucket, not a guarantee.
THEME_TO_CATEGORY = {
    "Athletics": "sports",
    "CommunityService": "community",
    "Fundraising": "community",
    "GroupBusiness": "student_org",
    "Social": "student_org",
    "ThoughtfulLearning": "academic",
    "Arts": "campus",
    "Cultural": "campus",
    "Spirituality": "campus",
}


class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def get_text(self):
        return "".join(self.parts)


def strip_html(html):
    if not html:
        return ""
    stripper = _HTMLStripper()
    stripper.feed(html)
    return re.sub(r"\s+", " ", stripper.get_text()).strip()


def fetch_page(skip, take, params):
    query = dict(params)
    query.update({"skip": skip, "take": take})
    url = API_URL + "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as resp:
        import json
        return json.loads(resp.read().decode("utf-8"))


def fetch_upcoming_events(days_ahead: int, delay: float = 0.2) -> list[dict]:
    now = datetime.now(timezone.utc)
    until = now + timedelta(days=days_ahead)
    params = {
        "orderByField": "startsOn",
        "orderByDirection": "ascending",
        "status": "Approved",
        "endsAfter": now.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "startsBefore": until.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    }
    events = []
    skip = 0
    total = None
    while True:
        data = fetch_page(skip, PAGE_SIZE, params)
        if total is None:
            total = data.get("@odata.count", 0)
            print(f"  Owl Central: {total} upcoming events in next {days_ahead}d", file=sys.stderr)
        batch = data.get("value", [])
        if not batch:
            break
        events.extend(batch)
        skip += len(batch)
        if skip >= total:
            break
        time.sleep(delay)
    return events


def to_raw_row(event: dict) -> dict:
    image_path = event.get("imagePath") or event.get("organizationProfilePicture")
    return {
        "id": event.get("id"),
        "name": (event.get("name") or "").strip(),
        "organization": (event.get("organizationName") or "").strip(),
        "starts_on": event.get("startsOn"),
        "ends_on": event.get("endsOn"),
        "location": event.get("location"),
        "theme": event.get("theme"),
        "categories": ", ".join(event.get("categoryNames") or []),
        "rsvp_total": event.get("rsvpTotal"),
        "description": strip_html(event.get("description")),
        "url": EVENT_URL_TMPL.format(id=event.get("id")),
        "image_url": IMAGE_URL_TMPL.format(path=image_path) if image_path else "",
    }


def _fmt_time_et(iso_utc: str | None) -> str | None:
    if not iso_utc:
        return None
    dt = datetime.fromisoformat(iso_utc).astimezone(EASTERN)
    return dt.strftime("%I:%M %p").lstrip("0")


def to_college_events_row(event: dict) -> dict | None:
    """Maps one Owl Central event into the exact CSV shape College-events'
    import-csv command expects (see packages/ingestion/src/csv-events.ts).
    Skips events with no real start time -- a handful of very old/malformed
    Engage records report a 1970-01-01 sentinel instead of a real date, and
    the importer needs a real one."""
    starts_on = event.get("startsOn")
    if not starts_on:
        return None
    dt_utc = datetime.fromisoformat(starts_on)
    if dt_utc.year < 2000:
        return None
    dt_et = dt_utc.astimezone(EASTERN)

    start_time = _fmt_time_et(starts_on)
    end_time = _fmt_time_et(event.get("endsOn"))
    time_field = f"{start_time}-{end_time}" if start_time and end_time else (start_time or "")

    image_path = event.get("imagePath") or event.get("organizationProfilePicture")
    theme = event.get("theme") or ""

    return {
        "Date": dt_et.strftime("%Y-%m-%d"),
        "Time (ET)": time_field,
        "Event": (event.get("name") or "").strip(),
        "Category": THEME_TO_CATEGORY.get(theme, "other"),
        "Presenter/Team": (event.get("organizationName") or "").strip(),
        "Venue": event.get("location") or "",
        "Notes": strip_html(event.get("description")),
        "Image URL": IMAGE_URL_TMPL.format(path=image_path) if image_path else "",
        "Link": EVENT_URL_TMPL.format(id=event.get("id")),
    }


def save_raw_csv(events: list[dict], path: Path) -> int:
    rows = [to_raw_row(e) for e in events]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=RAW_FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def save_college_events_csv(events: list[dict], path: Path) -> int:
    converted = [c for c in (to_college_events_row(e) for e in events) if c is not None]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLLEGE_EVENTS_FIELDNAMES)
        writer.writeheader()
        writer.writerows(converted)
    return len(converted)


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape Owl Central (FAU Campus Labs Engage) into College-events-ready CSVs.")
    parser.add_argument("--days-ahead", type=int, default=60, help="Only include events starting within N days from now (default: 60)")
    parser.add_argument("--out-dir", default=str(Path(__file__).parent), help="directory for output CSVs")
    args = parser.parse_args()

    print(f"Loading Owl Central (FAU): {API_URL} ...", file=sys.stderr)
    events = fetch_upcoming_events(args.days_ahead)
    print(f"  found {len(events)} events.", file=sys.stderr)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not events:
        print("  no events found -- the API may have changed.", file=sys.stderr)
        return

    raw_path = out_dir / "owlcentral_events_fau.csv"
    raw_count = save_raw_csv(events, raw_path)
    print(f"  saved {raw_count} events to {raw_path}", file=sys.stderr)

    ce_path = out_dir / "college_events_import_fau_owlcentral.csv"
    ce_count = save_college_events_csv(events, ce_path)
    print(f"  wrote {ce_count} College-events-ready rows to {ce_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
