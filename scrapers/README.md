# Scrapers

Two Python scrapers that feed College-events, each covering multiple schools
via its own config file (`engage_schools.json`, `schools.json`). Both write a
`college_events_import_*.csv` in the exact shape `apps/worker`'s
`import-csv` command expects (see `packages/ingestion/src/csv-events.ts`).

They live here rather than in a separate repo so the daily GitHub Actions
workflow (`.github/workflows/daily.yml`) can run them on a schedule — when
they ran only on a laptop via cron, fresh data depended on that laptop
being awake.

| Script | Source | Needs a browser? | Runs in CI? |
|---|---|---|---|
| `scrape_owlcentral.py` | Campus Labs Engage JSON API (any school on the platform — FAU calls theirs "Owl Central") | No — stdlib HTTP | Yes |
| `scrape_posh.py` | posh.vip nightlife listings | **Yes** — Playwright/Chromium; listings render client-side | **No — blocked, see below** |

## Campus Labs Engage: adding a school

Campus Labs Engage (`<subdomain>.campuslabs.com/engage`) is a multi-tenant
platform — the JSON API, field shapes, and theme taxonomy are identical
across every school on it, only the subdomain changes. `scrape_owlcentral.py`
reads `engage_schools.json` to know which subdomain maps to which school:

```json
[
  { "school": "FAU", "subdomain": "fau" },
  { "school": "ANOTHERSCHOOL", "subdomain": "anotherschool" }
]
```

`school` must match `schools.short_name` in the database. Find a school's
subdomain by opening their Engage site (usually linked from the student
involvement/orgs page) — it's the part before `.campuslabs.com` in the URL,
e.g. `https://fau.campuslabs.com/engage/...` → `fau`. Confirm it's really
Engage by checking that `https://<subdomain>.campuslabs.com/engage/api/discovery/event/search`
returns JSON, not a 404.

Every school in the config is scraped by default, each writing its own pair
of files: `owlcentral_events_<school>.csv` (raw) and
`college_events_import_<school>_owlcentral.csv` (College-events-ready).
Pass `--school NAME` to scrape just one, or `--subdomain xyz` for a one-off
ad-hoc scrape that bypasses the config entirely.

## posh.vip: two separate problems, one fixed

**1. Two card lists that mean different things (handled 2026-08-21).**

| Class | What it is |
|---|---|
| `.EventCard` | the result grid scoped to the URL's location — **the only thing scraped** |
| `.explore-event-card` | a trending rail that ignores the location — **never scraped** |

Scraping the rail for FAU returned 26 out-of-state events out of 40 (DC, NY,
TX, CA, NC, PA, SC, MD), each rendered twice. It was briefly used as a fallback
on the theory that some events beat none; that was wrong. Wrong-city nightlife
in an FAU post is a silent error that looks like a successful run, so the rail
is never used — a location that yields no `.EventCard` yields nothing.

**The grid renders on scroll.** It sits below a hero carousel and the rail, and
mounts as it comes into view, so waiting alone never summons it — the scraper
scrolls until it appears. If you see `0 cards found` alongside a note about
trending-rail cards, the grid never mounted; re-run, and use `--diagnose` if it
persists.

As a backstop, every scrape also drops events whose address is outside the
state the URL asked for (`Fort Lauderdale, FL, USA` → `FL`), listing what it
dropped. Events with no parseable address are kept — the detail fetch fails
often enough that dropping those would lose real local events.

Because the class names moved once, extraction no longer leans on them: the
card only has to yield the event's **slug**, and everything the importer needs
(name, times, venue, address, description, image) comes from the schema.org
JSON-LD on that event's `/e/` page. Card title/date/venue are best-effort
fallbacks and may be `null`.

**2. Cloudflare challenges headless runs (not fixed, not fixable here).**
Headless requests get a managed challenge ("Just a moment...") instead of the
listings — confirmed from GitHub Actions runners *and* from a residential
connection, so this is not about datacenter IPs. `--headed` is not challenged.

The scraper does not try to defeat the challenge: no CAPTCHA-solving services,
no fingerprint spoofing, no proxies. `robots.txt` permitting `/explore` does
not override an active edge challenge. It detects the interstitial, stops with
a clear message and exit code 3, and the daily workflow marks that step
`continue-on-error` so Owl Central and FAU Athletics still flow into the day's
posts.

**Net effect: this source cannot run unattended in CI, but `--headed` works
locally.**

Getting nightlife events in, in order of preference:

1. **Ask posh.vip for feed/API access.** The durable fix if they agree.
2. **Import manually with `--headed`.** A real browser window opens and is
   generally *not* challenged; if one does appear, solve it and the scrape
   continues (it waits up to 3 minutes). This is the only route that reaches
   the listings, since headless runs are challenged everywhere:

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
