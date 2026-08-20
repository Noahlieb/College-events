# Scrapers

Two Python scrapers that feed College-events. Both write a
`college_events_import_*.csv` in the exact shape `apps/worker`'s
`import-csv` command expects (see `packages/ingestion/src/csv-events.ts`).

They live here rather than in a separate repo so the daily GitHub Actions
workflow (`.github/workflows/daily.yml`) can run them on a schedule — when
they ran only on a laptop via cron, fresh data depended on that laptop
being awake.

| Script | Source | Needs a browser? |
|---|---|---|
| `scrape_owlcentral.py` | Owl Central (Campus Labs Engage JSON API) | No — stdlib HTTP |
| `scrape_posh.py` | posh.vip nightlife listings | **Yes** — Playwright/Chromium; listings render client-side |

The third source, **FAU Athletics**, needs no scraper here: it has a native
adapter in `packages/ingestion` (`sidearmAthleticsAdapter`) and is polled
directly by `pnpm worker ingest`.

## schools.json

`scrape_posh.py` reads this to know which posh.vip location page maps to
which school. Each entry needs a `school` (matching `schools.short_name` in
the database) and the `url` of that school's posh.vip explore page.

**Verify the URL for your campus.** posh.vip scopes listings by location,
so a wrong or missing location parameter silently scrapes the wrong city's
nightlife — the scrape "succeeds" and the bad events flow all the way into
a post. Open the URL in a browser and confirm the events shown are the ones
you want before trusting a run.

## Running locally

```bash
pip install -r scrapers/requirements.txt
python -m playwright install chromium

python scrapers/scrape_owlcentral.py --out-dir /tmp/scrape
python scrapers/scrape_posh.py --out-dir /tmp/scrape

pnpm worker import-csv FAU /tmp/scrape/college_events_import_fau_owlcentral.csv \
  owlcentral-scraper --source="Owl Central (CSV Import)"
pnpm worker import-csv FAU /tmp/scrape/college_events_import_fau.csv \
  posh-scraper --source="Posh.vip Nightlife"
```

Re-importing the same CSV daily is safe: `import-csv` dedupes on
name/date/venue and merges repeats rather than creating duplicates.
