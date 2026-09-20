#!/usr/bin/env python3
"""
scrape.py — Stage 1: pull raw Instagram posts from Apify for all six campuses.

Two actor calls per campus:
  - DISCOVERY (data-slayer/instagram-keyword-posts-scraper): keyword search,
    finds new deal-posting accounts you don't already follow. No login needed,
    returns full captions.
  - MONITORING (apify/instagram-scraper): known deal-account scrape via
    directUrls, resultsType "posts", onlyPostsNewerThan MONITOR_LOOKBACK so
    daily runs stay incremental and cheap.

Each item is tagged with:
  _campus_queried   which campus config this item came from
  _source           "discovery" | "monitor"
so Stage 2 (filter_deals.py) can catch wrong-campus / wrong-school results.

Usage:
    python scrape.py                      # both modes, all 6 campuses
    python scrape.py --mode discovery
    python scrape.py --mode monitor
    python scrape.py --campus FAU FSU
    python scrape.py --discovery-limit 30 --monitor-limit 50

Output:
    data/raw/<campus>_discovery.json
    data/raw/<campus>_monitor.json
    data/raw/latest.json   (combined — what filter_deals.py reads by default)

Note: `data-slayer/instagram-keyword-posts-scraper` is a community actor;
if Apify changes its input field names, check the actor's Input tab in the
Apify Console and update run_discovery() below. `apify/instagram-scraper`'s
directUrls/resultsType/onlyPostsNewerThan fields are the documented, stable
input for that actor.
"""
import argparse
import json
import sys

from apify_client import ApifyClient

import config


def get_client():
    if not config.APIFY_TOKEN:
        sys.exit(
            "APIFY_TOKEN is not set. Copy .env.example to .env and add your "
            "Apify API token (console.apify.com/account/integrations)."
        )
    return ApifyClient(config.APIFY_TOKEN)


def run_discovery(client, campus, limit):
    cfg = config.CAMPUS[campus]
    queries = cfg["search_queries"]
    print(f"  [discovery] {campus}: {queries}")
    run_input = {
        "searchQueries": queries,
        "resultsLimit": limit,
    }
    run = client.actor(config.DISCOVERY_ACTOR).call(run_input=run_input)
    items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    for item in items:
        item["_campus_queried"] = campus
        item["_source"] = "discovery"
    return items


def run_monitor(client, campus, limit):
    cfg = config.CAMPUS[campus]
    accounts = cfg["deal_accounts"]
    if not accounts:
        print(f"  [monitor]   {campus}: no deal_accounts configured, skipping")
        return []
    urls = [f"https://www.instagram.com/{a}/" for a in accounts]
    print(f"  [monitor]   {campus}: {accounts} (newer than {config.MONITOR_LOOKBACK})")
    run_input = {
        "directUrls": urls,
        "resultsType": "posts",
        "resultsLimit": limit,
        "onlyPostsNewerThan": config.MONITOR_LOOKBACK,
    }
    run = client.actor(config.MONITOR_ACTOR).call(run_input=run_input)
    items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    for item in items:
        item["_campus_queried"] = campus
        item["_source"] = "monitor"
    return items


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--campus", nargs="+", choices=list(config.CAMPUS), default=list(config.CAMPUS))
    ap.add_argument("--mode", choices=["discovery", "monitor", "both"], default="both")
    ap.add_argument("--discovery-limit", type=int, default=30, help="max results per discovery query batch")
    ap.add_argument("--monitor-limit", type=int, default=50, help="max results per monitored account batch")
    args = ap.parse_args()

    client = get_client()
    all_items = []

    for campus in args.campus:
        print(f"campus: {campus}")
        campus_items = []
        if args.mode in ("discovery", "both"):
            try:
                items = run_discovery(client, campus, args.discovery_limit)
                campus_items += items
                (config.RAW_DIR / f"{campus}_discovery.json").write_text(json.dumps(items, indent=2))
                print(f"    -> {len(items)} discovery posts")
            except Exception as e:
                print(f"    !! discovery failed for {campus}: {e}")
        if args.mode in ("monitor", "both"):
            try:
                items = run_monitor(client, campus, args.monitor_limit)
                campus_items += items
                (config.RAW_DIR / f"{campus}_monitor.json").write_text(json.dumps(items, indent=2))
                print(f"    -> {len(items)} monitor posts")
            except Exception as e:
                print(f"    !! monitor failed for {campus}: {e}")
        all_items += campus_items

    latest_path = config.RAW_DIR / "latest.json"
    latest_path.write_text(json.dumps(all_items, indent=2))
    print(f"\nwrote {len(all_items)} total raw posts -> {latest_path}")
    print("next: python filter_deals.py")

    missing = config.missing_handles()
    if missing:
        print(
            f"\nnote: no deal_accounts configured yet for {', '.join(missing)} "
            "— monitoring skipped for them, only keyword discovery ran."
        )


if __name__ == "__main__":
    main()
