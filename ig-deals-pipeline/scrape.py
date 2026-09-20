#!/usr/bin/env python3
"""
scrape.py — Stage 1: pull raw Instagram posts from Apify for the configured campuses.

Two Apify Actors, run separately because they do different jobs:

  DISCOVERY   data-slayer/instagram-keyword-posts-scraper
    Keyword/caption search — finds deals from businesses you don't already
    follow. Input: {"searchQueries": [...], "maxResultsPerQuery": N}.
    No login needed; returns full captions, username, likes, image URL.

  MONITORING  apify/instagram-scraper
    Watches your own known deal accounts. Input: {"directUrls": [...],
    "resultsType": "posts", "resultsLimit": N, "onlyPostsNewerThan": "2 days"}.
    Pay-per-result (~$0.0027/post on the free tier) — onlyPostsNewerThan is
    what keeps daily runs cheap. This actor's "search" mode with
    searchType "hashtag" returns hashtag METADATA, not a post feed — never
    used here; directUrls + resultsType "posts" is the only mode this script
    calls it with.

Field-name note: I could not independently confirm these against the Apify
API or Store in this session — api.apify.com and apify.com are both blocked
by this sandbox's network egress policy, so a live schema fetch wasn't
possible before writing this. The fields above are taken from your own
live-verified usage (apify/instagram-scraper) and your explicit spec (the
community discovery actor). Apify validates actor input server-side and
returns a descriptive error on a bad field name; run_actor_and_fetch() below
surfaces that error verbatim instead of swallowing it, so a wrong field name
fails loudly on your first small test run rather than just returning nothing.
`python scrape.py --describe-actors` does a best-effort dump of whatever
input-schema info the API exposes for both actors, at no cost, if you want a
second check before scaling up.

Each raw item is tagged with:
  _campus_queried   which campus config this item came from
  _source           "discovery" | "monitor"
so Stage 2 (filter_deals.py) can catch wrong-campus / wrong-school results.

Usage:
    python scrape.py                      # both modes, all configured campuses, SMALL limits
    python scrape.py --campus FAU
    python scrape.py --mode discovery
    python scrape.py --mode monitor
    python scrape.py --discovery-limit 5 --monitor-limit 10   # these are already the defaults
    python scrape.py --describe-actors    # best-effort input-schema dump, no scraping, no cost

Output:
    data/raw/<campus>_<YYYY-MM-DD>.json   merged discovery+monitor items for that
                                           campus/date — what filter_deals.py reads by default

Run the first real scrape on ONE campus with a low limit before scaling to
all six — see the README's Stage 1 section for the ToS/cost tradeoffs
between discovery (accounts you don't own) and monitoring (your own network).
"""
import argparse
import json
import sys
from datetime import date

from apify_client import ApifyClient

import config

DISCOVERY_COST_NOTE = "community actor — pricing model not confirmed, keep maxResultsPerQuery small"
MONITOR_COST_NOTE = "~$0.0027/post on the Apify free tier"
RUN_POLL_TIMEOUT_SECS = 180


def get_client():
    if not config.APIFY_TOKEN:
        sys.exit(
            "APIFY_TOKEN is not set. Copy .env.example to .env and add your "
            "Apify API token (console.apify.com/account/integrations)."
        )
    return ApifyClient(config.APIFY_TOKEN)


def run_actor_and_fetch(client, actor_id, run_input, label):
    """Explicit start -> poll -> fetch-dataset flow (rather than the SDK's
    .call() convenience wrapper), so progress is visible and Apify's own
    input-validation error comes through verbatim if a field name is wrong."""
    print(f"    starting {label} run ({actor_id})...")
    try:
        run = client.actor(actor_id).start(run_input=run_input)
    except Exception as e:
        raise RuntimeError(f"{label}: failed to start run — {e}") from e

    run_id = run["id"]
    print(f"    run {run_id} started, polling for completion...")
    finished = client.run(run_id).wait_for_finish(wait_secs=RUN_POLL_TIMEOUT_SECS)
    if finished is None:
        raise RuntimeError(
            f"{label}: run {run_id} did not finish within {RUN_POLL_TIMEOUT_SECS}s "
            f"— check its status at console.apify.com/actors/runs/{run_id}"
        )
    if finished["status"] != "SUCCEEDED":
        # A bad field name shows up here, in Apify's own words — don't swallow it.
        raise RuntimeError(
            f"{label}: run ended with status {finished['status']}: "
            f"{finished.get('statusMessage', '(no message)')}"
        )

    return list(client.dataset(finished["defaultDatasetId"]).iterate_items())


def run_discovery(client, campus, max_results_per_query):
    cfg = config.CAMPUS[campus]
    queries = cfg["search_queries"]
    print(f"  [discovery] {campus}: {queries} ({DISCOVERY_COST_NOTE})")
    run_input = {
        "searchQueries": queries,
        "maxResultsPerQuery": max_results_per_query,
    }
    items = run_actor_and_fetch(client, config.DISCOVERY_ACTOR, run_input, f"{campus} discovery")
    for item in items:
        item["_campus_queried"] = campus
        item["_source"] = "discovery"
    return items


def run_monitor(client, campus, results_limit):
    cfg = config.CAMPUS[campus]
    accounts = cfg["deal_accounts"]
    if not accounts:
        print(f"  [monitor]   {campus}: no deal_accounts configured, skipping")
        return []
    urls = [f"https://www.instagram.com/{a}/" for a in accounts]
    print(f"  [monitor]   {campus}: {accounts} (newer than {config.MONITOR_LOOKBACK}, {MONITOR_COST_NOTE})")
    run_input = {
        "directUrls": urls,
        "resultsType": "posts",
        "resultsLimit": results_limit,
        "onlyPostsNewerThan": config.MONITOR_LOOKBACK,
    }
    items = run_actor_and_fetch(client, config.MONITOR_ACTOR, run_input, f"{campus} monitor")
    for item in items:
        item["_campus_queried"] = campus
        item["_source"] = "monitor"
    return items


def describe_actors(client):
    """Best-effort input-schema dump so you can eyeball field names before a
    real run, at no cost. Not authoritative — several Apify API shapes are
    possible depending on how an actor publishes its schema; if this comes
    back empty or errors, check the actor's Input tab on its Apify Store
    page by hand (e.g. apify.com/data-slayer/instagram-keyword-posts-scraper
    /input-schema)."""
    for actor_id in (config.DISCOVERY_ACTOR, config.MONITOR_ACTOR):
        print(f"\n=== {actor_id} ===")
        try:
            actor = client.actor(actor_id).get()
            schema = (actor or {}).get("inputSchema")
            if not schema:
                builds = client.actor(actor_id).builds().list(limit=1, desc=True).items
                if builds:
                    build = client.build(builds[0]["id"]).get()
                    schema = (build or {}).get("inputSchema")
            if schema:
                print(schema if isinstance(schema, str) else json.dumps(schema, indent=2))
            else:
                print(f"(no inputSchema exposed via the API for this actor — "
                      f"check https://apify.com/{actor_id}/input-schema by hand)")
        except Exception as e:
            print(f"could not fetch schema via the API ({e}) — "
                  f"check https://apify.com/{actor_id}/input-schema by hand)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--campus", nargs="+", choices=list(config.CAMPUS), default=list(config.CAMPUS))
    ap.add_argument("--mode", choices=["discovery", "monitor", "both"], default="both")
    ap.add_argument("--discovery-limit", type=int, default=5,
                     help="maxResultsPerQuery for the discovery actor (default kept small on purpose)")
    ap.add_argument("--monitor-limit", type=int, default=10,
                     help="resultsLimit for the monitor actor (default kept small on purpose)")
    ap.add_argument("--describe-actors", action="store_true",
                     help="print a best-effort input schema for both actors and exit — no scraping, no cost")
    args = ap.parse_args()

    client = get_client()

    if args.describe_actors:
        describe_actors(client)
        return

    today = date.today().isoformat()
    grand_total = 0

    for campus in args.campus:
        print(f"campus: {campus}")
        campus_items = []
        if args.mode in ("discovery", "both"):
            try:
                items = run_discovery(client, campus, args.discovery_limit)
                campus_items += items
                print(f"    -> {len(items)} discovery posts")
            except Exception as e:
                print(f"    !! discovery failed for {campus}: {e}")
        if args.mode in ("monitor", "both"):
            try:
                items = run_monitor(client, campus, args.monitor_limit)
                campus_items += items
                print(f"    -> {len(items)} monitor posts")
            except Exception as e:
                print(f"    !! monitor failed for {campus}: {e}")

        out_path = config.RAW_DIR / f"{campus}_{today}.json"
        out_path.write_text(json.dumps(campus_items, indent=2))
        print(f"    wrote {len(campus_items)} total ({campus}, discovery+monitor merged) -> {out_path}")
        grand_total += len(campus_items)

    print(f"\n{grand_total} posts total across {len(args.campus)} campus(es) for {today}.")
    print(f"next: python filter_deals.py   (reads data/raw/*_{today}.json by default)")

    missing = config.missing_handles()
    if missing:
        print(
            f"\nnote: no deal_accounts configured yet for {', '.join(missing)} "
            "— monitoring skipped for them, only keyword discovery ran."
        )


if __name__ == "__main__":
    main()
