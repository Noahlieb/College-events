# Scrapers

Two Python scrapers that feed College-events. Both write a
`college_events_import_*.csv` in the exact shape `apps/worker`'s
`import-csv` command expects (see `packages/ingestion/src/csv-events.ts`).

They live here rather than in a separate repo so the daily GitHub Actions
workflow (`.github/workflows/daily.yml`) can run them on a schedule — when
they ran only on a laptop via cron, fresh data depended on that laptop
being awake.

| Script | Source | Needs a browser? | Runs in CI? |
|---|---|---|---|
| `scrape_owlcentral.py` | Owl Central (Campus Labs Engage JSON API) | No — stdlib HTTP | Yes |
| `scrape_posh.py` | posh.vip nightlife listings | **Yes** — Playwright/Chromium; listings render client-side | **No — blocked, see below** |

## posh.vip challenges headless browsers

posh.vip runs Cloudflare bot management in front of `/explore` and serves a
managed challenge ("Performing security verification") instead of the listings.

Confirmed 2026-08-21, both FAU locations, **from GitHub Actions runners _and_
from a residential connection** — so this is not about datacenter IP ranges.
Playwright's headless Chromium is what gets flagged, wherever it runs. This
scraper used to work unattended; posh.vip appears to have tightened its bot
management since.

**This is the site's deliberate access control, so the scraper does not try to
defeat it** — no CAPTCHA-solving services, no fingerprint spoofing, no
residential proxies. `robots.txt` permitting `/explore` does not override an
active edge challenge.

What the scraper does instead: it detects the challenge, gives it a short
grace period in case it clears on its own, then stops with a clear "blocked by
Cloudflare" message and exit code 3. The daily workflow marks that step
`continue-on-error`, so Owl Central and FAU Athletics still flow into the
day's posts; the run summary reports the block explicitly rather than
reporting zero events.

Getting nightlife events in, in order of preference:

1. **Ask posh.vip for feed/API access.** The durable fix if they agree.
2. **Import manually with `--headed`.** A real browser window opens; when the
   challenge appears, solve it yourself and the scrape continues (it waits up
   to 3 minutes for you). This is the only route that still reaches the
   listings, since headless runs are challenged everywhere:

   ```bash
   python scrapers/scrape_posh.py --headed --out-dir /tmp/scrape
   pnpm worker import-csv FAU /tmp/scrape/college_events_import_fau.csv \
     posh-scraper --source="Posh.vip Nightlife"
   pnpm worker select-posts FAU && pnpm worker render-all FAU
   ```
3. **Enter events by hand** in the dashboard for the ones that matter.

Re-importing is always safe — `import-csv` dedupes on name/date/venue.

The third source, **FAU Athletics**, needs no scraper here: it has a native
adapter in `packages/ingestion` (`sidearmAthleticsAdapter`) and is polled
directly by `pnpm worker ingest`.

## schools.json

`scrape_posh.py` reads this to know which posh.vip location pages map to
which school. Each entry needs a `school` (matching `schools.short_name` in
the database) and either a single `url` or a `urls` list.

A school can span several nightlife areas — FAU students go out in both
Boca Raton and Fort Lauderdale — so list them under **one** entry:

```json
[{ "school": "FAU", "urls": ["...boca...", "...fort-lauderdale..."] }]
```

All of a school's locations are scraped and merged into one import CSV,
deduped on each event's own page URL (nearby feeds overlap). Listing the
same school twice as separate entries is rejected with an error: the
per-school import CSV is written in `"w"` mode, so the second entry would
silently overwrite the first and drop half the events.

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
