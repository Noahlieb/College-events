#!/usr/bin/env python3
"""Scrape every configured school -- Campus Labs Engage and generic alike --
in one run.

Runs scrape_owlcentral.py across every school in engage_schools.json and
scrape_generic.py across every school in generic_schools.json, writing each
school's usual pair of CSVs (raw + college_events_import_<school>_*.csv --
identical to what running either script directly for that school produces),
plus one merged all_schools_events.csv across every school and platform for
a quick look at everything scraped in one place:

    python scrapers/scrape_all.py --out-dir /tmp/scrape --days-ahead 7

The merged CSV is a convenience overview only. It is not what
`pnpm worker import-csv` takes -- that command still needs one school's
college_events_import_<school>_*.csv at a time (see scrapers/README.md),
since each import call names the one school the rows belong to.

Adding a school here means adding it to whichever per-scraper config
already fits it (engage_schools.json for Campus Labs Engage,
generic_schools.json for anything else with an events page or .ics feed)
-- this script itself has no per-school knowledge.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import scrape_generic as generic  # noqa: E402
import scrape_owlcentral as owlcentral  # noqa: E402

ALL_SCHOOLS_FIELDNAMES = ["school", "platform", "name", "organization", "starts_on", "ends_on",
                           "location", "description", "url", "image_url"]


def _to_overview_row(school: str, platform: str, row: dict) -> dict:
    return {
        "school": school,
        "platform": platform,
        "name": row.get("name", ""),
        "organization": row.get("organization", ""),
        "starts_on": row.get("starts_on", ""),
        "ends_on": row.get("ends_on", ""),
        "location": row.get("location", ""),
        "description": row.get("description", ""),
        "url": row.get("url", ""),
        "image_url": row.get("image_url", ""),
    }


def run_engage_schools(config_path: Path, days_ahead: int, out_dir: Path) -> list[dict]:
    if not config_path.exists():
        print(f"No Engage config at {config_path} -- skipping Campus Labs Engage schools.", file=sys.stderr)
        return []

    merged = []
    for s in owlcentral.load_schools(config_path):
        school, subdomain = s["school"], s["subdomain"]
        school_lower = school.lower()
        api_url = owlcentral.API_URL_TMPL.format(subdomain=subdomain)
        print(f"Loading Campus Labs Engage ({school}): {api_url} ...", file=sys.stderr)
        events = owlcentral.fetch_upcoming_events(subdomain, days_ahead)
        print(f"  found {len(events)} events.", file=sys.stderr)
        if not events:
            continue

        raw_path = out_dir / f"owlcentral_events_{school_lower}.csv"
        raw_count = owlcentral.save_raw_csv(events, subdomain, raw_path)
        print(f"  saved {raw_count} events to {raw_path}", file=sys.stderr)

        ce_path = out_dir / f"college_events_import_{school_lower}_owlcentral.csv"
        ce_count = owlcentral.save_college_events_csv(events, subdomain, ce_path)
        print(f"  wrote {ce_count} College-events-ready rows to {ce_path}", file=sys.stderr)

        for e in events:
            merged.append(_to_overview_row(school, "campus_labs_engage", owlcentral.to_raw_row(e, subdomain)))
    return merged


def run_generic_schools(config_path: Path, days_ahead: int, out_dir: Path) -> list[dict]:
    if not config_path.exists():
        print(f"No generic-scraper config at {config_path} -- skipping.", file=sys.stderr)
        return []
    with config_path.open() as f:
        schools = json.load(f)

    merged = []
    for s in schools:
        school, url = s["school"], s["url"]
        school_lower = school.lower()
        is_ics = url.lower().split("?")[0].endswith(".ics")
        print(f"Loading {school}: {url} {'(.ics feed)' if is_ics else ''} ...", file=sys.stderr)
        events = generic.scrape_ics(url) if is_ics else generic.scrape_url(url, headless=True, debug_label=school_lower)
        print(f"  found {len(events)} event(s) total.", file=sys.stderr)

        events, dropped = generic.filter_by_window(events, days_ahead)
        if days_ahead > 0:
            print(f"  kept {len(events)} within the next {days_ahead}d ({dropped} outside the window or undated)", file=sys.stderr)
        if not events:
            continue

        raw_path = out_dir / f"generic_events_{school_lower}.csv"
        raw_count = generic.save_raw_csv(events, raw_path)
        print(f"  saved {raw_count} events to {raw_path}", file=sys.stderr)

        ce_path = out_dir / f"college_events_import_{school_lower}_generic.csv"
        ce_count = generic.save_college_events_csv(events, ce_path)
        print(f"  wrote {ce_count} College-events-ready rows to {ce_path}", file=sys.stderr)

        for row in events:
            merged.append(_to_overview_row(school, row.get("found_via", "generic"), row))
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape every configured school (Campus Labs Engage + generic) in one run.")
    parser.add_argument("--out-dir", default=str(Path(__file__).parent), help="directory for output CSVs")
    parser.add_argument("--days-ahead", type=int, default=60,
                         help="only keep events starting within N days from now (default: 60; 0 disables filtering)")
    parser.add_argument("--engage-config", default=str(Path(__file__).parent / "engage_schools.json"))
    parser.add_argument("--generic-config", default=str(Path(__file__).parent / "generic_schools.json"))
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    merged: list[dict] = []
    merged += run_engage_schools(Path(args.engage_config), args.days_ahead, out_dir)
    merged += run_generic_schools(Path(args.generic_config), args.days_ahead, out_dir)

    all_path = out_dir / "all_schools_events.csv"
    with all_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=ALL_SCHOOLS_FIELDNAMES)
        writer.writeheader()
        writer.writerows(merged)

    by_school: dict[str, int] = {}
    for row in merged:
        by_school[row["school"]] = by_school.get(row["school"], 0) + 1

    print("\nSummary:", file=sys.stderr)
    for school in sorted(by_school):
        print(f"  {school}: {by_school[school]} events", file=sys.stderr)
    print(f"  TOTAL: {len(merged)} events across {len(by_school)} school(s)", file=sys.stderr)
    print(f"\nWrote combined overview to {all_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
