#!/usr/bin/env python3
"""
run_pipeline.py — single entrypoint for the whole IG deals pipeline.

    python run_pipeline.py refresh        # Stage 1 + 2: scrape then filter (cron target)
    python run_pipeline.py scrape [...]   # Stage 1 only, forwards args to scrape.py
    python run_pipeline.py filter [...]   # Stage 2 only, forwards args to filter_deals.py
    python run_pipeline.py generate [...] # Stage 4 only, forwards args to generate_flyers.py
    python run_pipeline.py demo           # offline demo: filters + generates flyers from
                                           # tests/ sample data — no API keys required

Stage 3 (approval) is a human step, on purpose — open deal_approval.html in a
browser, approve/skip deals, and it downloads approved_deals.json for you to
drop into this folder before running `generate`.

Cron (daily morning refresh — scrape + filter only; approval and generation
stay manual steps you run after reviewing the queue):
    0 7 * * * cd /path/to/ig-deals-pipeline && /usr/bin/python3 run_pipeline.py refresh >> logs/refresh.log 2>&1
"""
import subprocess
import sys

import config

BASE = config.BASE_DIR
LOG_DIR = BASE / "logs"
LOG_DIR.mkdir(exist_ok=True)


def run(script, args):
    return subprocess.run([sys.executable, str(BASE / script), *args]).returncode


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd, rest = sys.argv[1], sys.argv[2:]

    if cmd == "scrape":
        sys.exit(run("scrape.py", rest))
    elif cmd == "filter":
        sys.exit(run("filter_deals.py", rest))
    elif cmd == "generate":
        sys.exit(run("generate_flyers.py", rest))
    elif cmd == "refresh":
        rc = run("scrape.py", rest)
        if rc != 0:
            print("scrape.py failed, skipping filter step")
            sys.exit(rc)
        sys.exit(run("filter_deals.py", []))
    elif cmd == "demo":
        print("=== demo: filtering tests/sample_apify_output.json (no API keys needed) ===")
        run("filter_deals.py", ["tests/sample_apify_output.json"])
        print("\n=== demo: generating flyers from tests/sample_approved_deals.json ===")
        run("generate_flyers.py", ["tests/sample_approved_deals.json"])
        print(f"\nopen deal_approval.html in a browser to see the real review queue.")
        print(f"check {config.OUTPUT_DIR} for the demo flyers + captions.")
    else:
        print(f"unknown command: {cmd}\n")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
