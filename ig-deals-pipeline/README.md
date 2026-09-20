# IG Deals Pipeline

Scrapes Instagram for student deals across six Florida campuses (FAU, FIU,
FSU, UCF, USF, University of Miami), filters out noise, lets you approve
deals in a local dashboard, and generates finished Instagram flyers +
captions per campus.

This is a standalone project inside the `College-events` repo — it does not
touch or depend on the unrelated TypeScript event-discovery monorepo living
alongside it (`packages/`, `apps/`).

```
SCRAPE (Apify) → FILTER (dedup + noise) → APPROVE (local HTML dashboard) →
GENERATE (AI art + Pillow text overlay + caption) → OUTPUT (output/<campus>/)
```

## Setup

```bash
cd ig-deals-pipeline
python3 -m pip install -r requirements.txt
cp .env.example .env
# edit .env: APIFY_TOKEN, OPENAI_API_KEY
```

Then fill in the deal-account handles for the campuses that still say `TODO`
in `config.py` (`CAMPUS[<code>]["deal_accounts"]`) — only FAU is populated
right now (`fau.events`, `fau_owlperks`, `faudining`, `sgatfau`). A campus
with no handles configured still gets keyword *discovery*, it just skips the
known-account *monitoring* pass until you add some.

## Try it with zero API keys first

```bash
python3 run_pipeline.py demo
```

Filters `tests/sample_apify_output.json` (synthetic posts modeled on real
Apify actor output, including a fake "FAU Erlangen-Nürnberg" German post and
a wrong-campus post, to prove the noise filter works) and generates flyers
from `tests/sample_approved_deals.json` using placeholder art + template
captions, so you can see the whole shape of the output before spending any
API credits.

## Running for real

```bash
python3 run_pipeline.py scrape          # Stage 1 — needs APIFY_TOKEN
python3 run_pipeline.py filter          # Stage 2 — no key needed
# open deal_approval.html in a browser, approve/skip deals,
# click "Export approved_deals.json", move the download into this folder
python3 run_pipeline.py generate        # Stage 4 — needs OPENAI_API_KEY for real art/captions
```

Or as one command for the automatable part (scrape + filter):

```bash
python3 run_pipeline.py refresh
```

### Stage 1 — scrape.py

Two Apify Actors, run separately because they do different jobs:

- **Discovery** — `data-slayer/instagram-keyword-posts-scraper`. Keyword/
  caption search per campus, input `{"searchQueries": [...],
  "maxResultsPerQuery": N}`. No login needed; returns full captions,
  username, likes, image URL. This is what finds deal-posting businesses you
  don't already follow. `config.py`'s `gen_queries()` generates each
  campus's query list from its name(s) crossed with a shared suffix template
  (bare name, "discount", "deals", "food", "student discount", ...) plus a
  couple of campus-specific extras — see `QUERY_SUFFIXES` in `config.py` to
  add more categories across all six campuses at once.
- **Monitoring** — `apify/instagram-scraper`. `directUrls` of each campus's
  known deal accounts, `resultsType: "posts"`, `resultsLimit`,
  `onlyPostsNewerThan` (default 2 days, `MONITOR_LOOKBACK` in `.env`) so
  daily runs stay incremental and cheap — roughly $0.0027/result on the free
  tier. This actor's `search` + `searchType: "hashtag"` mode returns hashtag
  *metadata*, not a post feed, and is never used here.
- Every raw item is tagged `_campus_queried` / `_source` so Stage 2 can catch
  wrong-campus results. Output is one file per campus per day —
  `data/raw/<campus>_<date>.json`, discovery + monitor merged — which
  `filter_deals.py` reads by default (all of today's campus files at once).
- **Field names are unverified against a live schema fetch** — this was
  built inside a sandbox where both `api.apify.com` and `apify.com` are
  blocked by network policy, so the actor input fields above come from the
  account owner's own live-tested usage, not an automated schema check.
  `scrape.py` starts each run explicitly (rather than using the SDK's
  fire-and-forget `.call()` helper) and surfaces Apify's own input-validation
  error verbatim if a field name is wrong, so a mismatch fails loudly on the
  first small test run instead of silently returning nothing.
  `python scrape.py --describe-actors` does a free best-effort dump of
  whatever input-schema info the API exposes, as a second check.
- Defaults are intentionally small (`--discovery-limit 5 --monitor-limit
  10`) — **run the first real scrape on one campus** (`--campus FAU`) and
  read the per-actor post counts it logs before scaling up to all six.

**A ToS note, not a blocker:** discovery pulls captions from accounts you
don't run or have a relationship with, which sits in a gray area under
Instagram's Terms of Service — keep queries targeted and volume reasonable.
Monitoring your own campus accounts is lower risk since it's your own
network. Apify's actors operate in that same gray area; that tradeoff is
yours to weigh, this code doesn't enforce or warn about it at runtime beyond
what's written here.

### Stage 2 — filter_deals.py

Adapted from the original `ig_deals_filter.py`, plus:

- **Noise filtering** — drops posts naming the *German* Friedrich-Alexander-
  Universität Erlangen-Nürnberg (also "FAU"), any post skewing German-language
  with no Florida location hint, and any post whose content clearly names a
  *different* Florida campus than the one queried (`wrong_campus_for_query`).
- **Business-name extraction** — pulls the actual merchant name out of the
  caption text (`"... at Lyft Rides"`, `"[solidcore] Boca — ..."`) instead of
  using the posting account's own display name. This matters because the
  original script used the poster's account name as `business`, which broke
  cross-account dedup for the exact case the spec calls out — the same deal
  reposted by a different account. Falls back to the account's display name
  when the caption doesn't have an obvious merchant mention.
- **Dedup signature** — now `campus + first 10 normalized caption words`
  instead of `account + first 12 words`, for the same cross-account-repost
  reason above.
- Outputs `data/deals_clean.json` (+ `.csv`) and `data/deals_data.js`, which
  `deal_approval.html` loads directly.
- `state/seen_posts.json` persists across runs — don't delete it, or you'll
  re-see everything you already reviewed.

### Stage 3 — deal_approval.html

Open it directly in a browser (no server needed — it loads
`data/deals_data.js` via a plain `<script src>` tag, which works over
`file://`). Approve or skip each deal; decisions persist in that browser's
`localStorage`. The square thumbnails are a **quick preview only** — the
real 1080×1350 IG flyer comes from Stage 4. Click **Export
approved_deals.json**, then move the downloaded file into this project
folder (overwriting the placeholder) before running Stage 4.

### Stage 4 — generate_flyers.py

Per the task's own text-accuracy warning, this never asks the image model to
render deal text:

1. OpenAI (`gpt-image-1`) generates **background artwork only** — campus
   colors, mascot motif, confetti/brush-stroke style, explicit instruction to
   leave the lower third clean and render no letters/words/numbers at all.
2. Pillow draws the exact hero/business/detail/promo-code/handle text on top
   as a crisp layer, over a dark gradient scrim for legibility — so prices
   and codes are always pixel-correct, never AI-garbled.
3. A short LLM call writes the caption (hook, deal details, code, hashtags,
   "send this to your group chat" CTA).

Without `OPENAI_API_KEY` set, both steps still run — background art falls
back to a campus-brand gradient and captions fall back to a template — so you
can test/tune the Pillow layout for free. Add the key and it automatically
switches to real AI art + LLM captions.

Drop matching `.ttf` files into `assets/fonts/` (e.g. `Anton-Regular.ttf`,
`Inter-ExtraBold.ttf`, matching the approval dashboard's own fonts) for the
flyer text to look identical to the preview. Falls back to system DejaVu Sans
Bold otherwise, which is legible but generic. Campus logos go in
`assets/logos/<CAMPUS>.png` (e.g. `assets/logos/FAU.png`) and are composited
automatically if present.

### Stage 5 — output

`output/<CAMPUS>/<business>.png` + `output/<CAMPUS>/<business>.txt` (caption),
ready to post by hand. **Auto-posting is a deliberate TODO** — wire up
Buffer/Later/Metricool or the Instagram Graph API here next.

## Cron (daily morning refresh)

```cron
0 7 * * * cd /path/to/ig-deals-pipeline && /usr/bin/python3 run_pipeline.py refresh >> logs/refresh.log 2>&1
```

This runs Stages 1–2 only (scrape + filter) — approval and generation stay
manual so you keep a human in the loop before anything goes out, per the
original design.

## Project layout

```
ig-deals-pipeline/
  config.py            campus branding, handles, search queries, .env loading
  scrape.py             Stage 1
  filter_deals.py        Stage 2
  deal_approval.html     Stage 3
  generate_flyers.py     Stage 4
  run_pipeline.py        one-command orchestration (scrape/filter/generate/refresh/demo)
  data/                  raw scrapes, filtered deals, dashboard data (gitignored)
  state/seen_posts.json  persistent dedup store — don't delete (gitignored)
  approved_deals.json    Stage 3 export, Stage 4 input (gitignored)
  output/<campus>/        finished flyers + captions (gitignored)
  flyers/<campus>/        cached raw AI background art (gitignored)
  assets/fonts, assets/logos   optional brand assets for Stage 4
  tests/                  offline sample fixtures for `run_pipeline.py demo`
```
