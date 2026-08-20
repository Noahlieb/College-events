# College Events Media Network

An automated event-intelligence and content engine for hyperlocal college Instagram
accounts. It discovers real events happening around a campus, extracts and scores
them with AI, and assembles them into branded Instagram carousels — with a human
approval step before anything goes out.

**First campus: Florida Atlantic University (Boca Raton, FL).** The system is
multi-tenant from day one (every table carries a `school_id`), so adding a second,
tenth, or fiftieth campus is a data/config change, not a rewrite.

```
EVENT DISCOVERY → EXTRACTION → NORMALIZATION → DEDUPLICATION → AI ANALYSIS →
RELEVANCE SCORING → CATEGORY ASSIGNMENT → VERIFICATION → WEEKLY POST SELECTION →
IMAGE/SLIDE GENERATION → CAPTION GENERATION → HUMAN APPROVAL → SCHEDULER → INSTAGRAM
```

## Table of contents

- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Running the pipeline](#running-the-pipeline)
- [The admin dashboard](#the-admin-dashboard)
- [Adding a new school](#adding-a-new-school)
- [Adding a new source](#adding-a-new-source)
- [Posting lanes](#posting-lanes)
- [Orchestration with n8n](#orchestration-with-n8n)
- [Testing](#testing)
- [Deploying](#deploying)
- [Credentials needed before live deployment](#credentials-needed-before-live-deployment)
- [Troubleshooting](#troubleshooting)
- [What's built vs. what's next](#whats-built-vs-whats-next)

## Architecture

A pnpm monorepo. Business logic lives in provider-agnostic packages; two thin apps
wire them together.

```
packages/
  core        pure domain logic — types, scoring, dedup, verification, date
              parsing, carousel selection. No I/O, fully unit tested.
  db          Drizzle ORM schema (Postgres/Supabase-compatible), migrations,
              seed data.
  ai          AIProvider abstraction — analyzeEvent, analyzeFlyer, classifyEvent,
              scoreEvent, summarizeEvent, generateCaption, compareDuplicates.
              Anthropic + OpenAI + Mock implementations behind one interface.
  ingestion   SourceAdapter abstraction — Owl Central/iCal, RSS/Atom, generic
              webpage (JSON-LD Event extraction), PhantomBuster importer,
              manual-entry shaping.
  render      Deterministic 1080x1350 branded slide renderer (Sharp + SVG
              templates). Shrink-to-fit text layout, category placeholder
              backgrounds, cover-slide template.
  scheduler   SchedulerProvider abstraction — Buffer + Mock implementations.

apps/
  worker      CLI that runs the pipeline: ingest, process (AI extraction),
              select-posts, render, approve, schedule, manual-entry. This is
              what n8n/cron calls in production.
  dashboard   Next.js admin dashboard — event inventory, weekly post/carousel
              preview, source management, human approval queue.
```

Every AI call, Instagram-collection call, and scheduler call goes through an
abstraction (`AIProvider`, `SourceAdapter`, `SchedulerProvider`) — application code
never imports `@anthropic-ai/sdk`, a PhantomBuster client, or the Buffer API
directly. Swapping providers is a config change (`AI_PROVIDER=anthropic|openai|mock`,
`SCHEDULER_PROVIDER=buffer|mock`), not a rewrite. When a provider's credentials are
missing, the factory falls back to a mock rather than blocking the pipeline —
see [Credentials needed before live deployment](#credentials-needed-before-live-deployment).

### Why this stack

- **Postgres via Drizzle**, not a hosted-Supabase-only approach — `DATABASE_URL`
  points anywhere Postgres-compatible, so local dev uses a plain local Postgres
  instance and production points at Supabase without any code change.
- **Deterministic SVG+Sharp rendering**, not generative image AI — spec explicitly
  wants consistency across 50-100 schools, and a template you can unit-test beats a
  model you can't.
- **JSON-LD extraction as the default "generic webpage" adapter** — most venue,
  ticketing, and Eventbrite-style pages already embed `schema.org/Event` structured
  data for SEO. That's a far more reliable structured source than HTML scraping, and
  needs no adapter per venue.
- **PhantomBuster as an importer, not a live dependency** — it's one JSON→raw_content
  mapping function. Swapping to the Meta API or another provider later means writing
  one new function with the same shape, not touching the AI/scoring/rendering layers.

## Project layout

```
.
├── packages/{core,db,ai,ingestion,render,scheduler}
├── apps/{worker,dashboard}
├── .env.example
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Local setup

Requires Node 20+, pnpm, and a Postgres instance (local install or Docker).

```bash
git clone <repo>
cd college-events
pnpm install

cp .env.example .env
# edit .env — at minimum set DATABASE_URL to a real Postgres instance.
# Everything else (AI, PhantomBuster, Buffer, admin password) has a safe
# default so the pipeline runs end-to-end with zero paid credentials.

# Point the dashboard at the same root .env (Next.js only reads .env files
# from its own app directory, not the monorepo root):
ln -s ../../.env apps/dashboard/.env.local

pnpm -r build          # compile every package to dist/ once
pnpm db:migrate        # create the schema
pnpm db:seed           # seed FAU: school, sources, sample events, pending raw_content

pnpm demo               # run the full pipeline end-to-end (see below)
```

If you don't have Postgres running yet:

```bash
# Debian/Ubuntu-style systems with postgresql already installed:
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER app WITH PASSWORD 'app' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE college_events OWNER app;"
# DATABASE_URL=postgres://app:app@localhost:5432/college_events
```

## Environment variables

See `.env.example` for the full annotated list. Highlights:

| Variable | Purpose | Default behavior if unset |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | required |
| `AI_PROVIDER` | `anthropic` \| `openai` \| `mock` | `mock` — deterministic, credential-free extraction |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Live AI credentials | falls back to mock with a console warning |
| `SCHEDULER_PROVIDER` | `buffer` \| `mock` | `mock` — logs the scheduled post, no real API call |
| `BUFFER_ACCESS_TOKEN` / `BUFFER_PROFILE_ID_<SHORTNAME>` | Live Buffer credentials | falls back to mock |
| `PHANTOMBUSTER_API_KEY` | Not required for the JSON importer path | only needed if you automate triggering PhantomBuster itself |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Dashboard HTTP Basic Auth | dashboard **fails closed** (500) if `ADMIN_PASSWORD` is unset |
| `LOCAL_STORAGE_DIR` | Where rendered/raw assets land in dev | `./storage` (resolved to an absolute repo-root path) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Production storage | unset in dev — local disk storage is used instead |

## Database

Drizzle ORM, schema in `packages/db/src/schema.ts`. Tables (all `school_id`-scoped
except `schools` itself): `schools`, `sources`, `raw_content`, `events`,
`event_sources`, `posts`, `post_events`, `rendered_assets`, `processing_logs`.

```bash
pnpm db:migrate     # apply migrations
pnpm db:seed        # (re-)seed FAU — safe to re-run, upserts the school row
pnpm db:reset        # DEV ONLY: drops and recreates the schema
pnpm db:studio       # drizzle-kit studio, a GUI over the current DB
```

Schema changes: edit `packages/db/src/schema.ts`, then
`pnpm --filter @college-events/db generate` to create a new migration file, and
`pnpm db:migrate` to apply it.

### Seed data

`pnpm db:seed` creates FAU plus 14 sources (campus + nearby + Instagram watchlist +
a manual-entry utility source), 13 fully-processed events, and 6 `pending`
`raw_content` rows for the AI pipeline to chew on. The seeded events deliberately
cover every tricky case from spec §37: a campus event corroborated by two sources
(merges into one `VERIFIED` event), an FAU sports game, a Boca concert, a Delray
nightlife event, a game with two sources reporting different kickoff times
(`CONFLICT`), an event with no image, an expired event, and a low-relevance distant
networking event.

The 4 Instagram-type sources are seeded with `active: false` — they need a live
PhantomBuster agent to produce anything (see below), so by default they just sit
in the `sources` table as inactive rows for UI/architecture completeness. Every
event and pending `raw_content` row that actually drives the demo/test run is
attributed to a real pollable source type instead (`owl_central`, `ical`, `rss`,
`generic_webpage`, `venue_website`, `athletics`, `eventbrite`) — i.e. `pnpm demo`
exercises the system entirely on public-web-shaped data, no PhantomBuster required.

## Running the pipeline

Everything below is a subcommand of the worker CLI (`pnpm --filter
@college-events/worker start <command>`, or `pnpm worker <command>` from the repo
root). `[school]` defaults to `FAU` (matches `schools.short_name`).

```bash
# 1. Discovery: poll every active, adapter-backed source for new content
pnpm worker ingest [school]

# Instagram is collected via PhantomBuster instead of a live poll — import
# its scrape output (see "PhantomBuster" below):
pnpm worker ingest:phantombuster [school] path/to/scrape-result.json

# 2. AI extraction/scoring/dedup over everything sitting at `pending`
pnpm worker process [school]

# 3. Build/refresh this week's 2 posts (Mon campus, Thu nightlife) from active events
pnpm worker select-posts [school]

# 4. Render one post's branded carousel (cover + one slide per event)
pnpm worker render <postId>

# 5. Human approval gate — nothing gets scheduled without this
pnpm worker approve <postId> <approvedBy>
pnpm worker reject <postId> "<reason>" <rejectedBy>

# 6. Send an approved, rendered post to the scheduler (Buffer or mock)
pnpm worker schedule <postId>

# Manual event entry — goes through the exact same downstream pipeline
# (scoring, dedup, rendering, selection) as an AI-extracted event; only the
# AI extraction step itself is skipped, since the fields are already known.
pnpm worker manual-entry [school] path/to/event.json

# Bulk import from a CSV — same idea as manual-entry, looped over many
# structured rows. See "CSV import" below for the expected columns.
pnpm worker import-csv [school] path/to/events.csv [submittedBy]

# The whole thing end-to-end, for demos:
pnpm demo
```

`pnpm demo` runs process → select-posts → render → (approve + schedule the Monday
post, to prove that leg too) → prints an event-inventory summary. It's what to run
after a fresh `db:seed` to see the system work.

### PhantomBuster import format

`pnpm worker ingest:phantombuster` accepts a JSON array of PhantomBuster Instagram
scraper rows. It accepts several field-name aliases since PhantomBuster's agents
differ slightly; at minimum each row needs a username and a post id. It caps to the
newest 5 posts per account by default (spec §8 — "has this account posted something
new," not a full history backfill), maps each account to the matching `sources` row
by `instagram_handle`, and inserts `pending` `raw_content` rows. All intelligence
happens downstream in `process` — PhantomBuster is purely collection.

### Owl Central / iCal / RSS

`ingest` uses structured feeds wherever possible, per the source-quality hierarchy
in spec §9: Owl Central and university-calendar sources are polled as iCal feeds
(a small dependency-free RFC 5545 parser in `packages/ingestion/src/ical.ts`); RSS/
Atom sources use `fast-xml-parser`; generic webpages, venue sites, ticketing sites,
and Eventbrite are all handled by one adapter that extracts `schema.org/Event`
JSON-LD — most such sites already publish it for SEO. Naive HTML scraping is
intentionally not implemented as a fallback (spec §9's explicit "don't rely on
brittle browser scraping" guidance); a page with no structured data simply yields
zero discovered items rather than erroring.

### CSV import

`pnpm worker import-csv [school] <file> [submittedBy]`, or the dashboard's **Import
CSV** page, bulk-adds events from a spreadsheet export. Each row is mapped to a
`ManualEventInput` (`packages/ingestion/src/csv-events.ts`) and run through
`submitManualEvent()` — the exact same scoring, dedup-against-existing-events, and
verification logic a single manual entry uses, just looped over many rows attached
to the school's `manual_submission` utility source. A bad row (missing name, an
unparseable date/time) is skipped with a reason rather than failing the whole
upload.

Column names are matched case-insensitively, and only Date/Time/Event are required:

| Column | Required | Format |
|---|---|---|
| Date | yes | `YYYY-MM-DD` |
| Time (ET) | yes | `9:00 AM` or `9:00 AM–11:00 AM` |
| Event | yes | event name |
| Category | no | one of `packages/core`'s `EVENT_CATEGORIES`, else a keyword guess from the name/notes |
| Presenter/Team | no | organization — also used to detect campus affiliation |
| Venue | no | `Venue Name, City` |
| Notes | no | free text — `21+` and `Recurring` are detected automatically |
| Image URL | no | stored as `sourceImage`; renders once image fetching has real network access |
| Link | no | the event's own page, stored as its source link |

No geocoding step exists yet, so distance-based scoring falls back to a small
known-city lookup table (`apps/worker/src/lib/geo-heuristic.ts`) rather than exact
coordinates — a real geocoder is a natural post-MVP upgrade, same as for
AI-extracted events.

## The admin dashboard

```bash
pnpm dashboard   # http://localhost:3000, HTTP Basic Auth via ADMIN_USERNAME/PASSWORD
```

- **Overview** — event counts by status/category, sources failing 3+ consecutive
  checks, this week's post statuses, and buttons to manually trigger `process`/
  `select-posts` (in production these run on a schedule — see n8n below).
- **Events** — full inventory with filters, per-event Approve/Reject/Force-include,
  and a detail page to edit fields or merge a duplicate into a primary event.
- **Weekly Posts** — one row per Monday/Thursday post; open a post to see the
  rendered carousel preview, the generated caption, and Approve/Reject/Render/
  Send-to-scheduler actions.
- **Sources** — table of every configured source with health status, plus an
  "Add source" form. This is the page a VA maintains sources through — no code
  changes needed to add a new venue/account/calendar.
- **Import CSV** — upload a spreadsheet of events (see "CSV import" above); shows
  a summary of what was created vs. merged vs. skipped after each upload.

Each event row in the Events tab shows its `sourceImage` as a thumbnail — a plain
`<img>` fetched by the viewer's own browser, so it renders normally in any real
deployment even though rendering the branded carousel (a server-side fetch,
composited via `sharp`) is a separate step with separate network requirements.

Rendering and every pipeline-triggering action run as a **worker CLI subprocess**,
not in-process inside the Next.js server. This is a deliberate boundary, not just a
workaround: `sharp` (native image bindings) doesn't play well with Next's server
bundler, and it's also the correct architecture — the dashboard triggers jobs, the
worker process executes them, exactly like an n8n-triggered run would.

## Adding a new school

The MVP doesn't ship the `npm run add-school` CLI from spec §49 yet, but the schema
and every pipeline function are already `school_id`-driven, so adding one today is:

1. Insert a `schools` row — name, short_name, city/state, lat/lng, timezone,
   `branding` (colors + font), `default_radius_miles`, `weekly_schedule` (which
   day/hour each post type publishes), `instagram_account`.
2. Insert `sources` rows for that school — campus + nearby + Instagram watchlist.
3. Run `pnpm worker ingest <shortName>`, `process`, `select-posts`, `render` as above.

`packages/db/src/seed/data.ts` is a complete worked example (FAU) to copy from. A
`npm run add-school` wizard that does step 1 interactively is a natural next
addition — it would just be a thin CLI prompt in front of the same `schools` insert.

## Adding a new source

Through the dashboard's **Sources** page (name, type, category, URL/Instagram
handle, priority 1-10, scrape frequency) — no code or redeploy needed. Priority
matters: it feeds `computeVerificationStatus` (spec §16) — two priority-6+ sources
agreeing on an event marks it `VERIFIED`; a single low-priority source stays
`NEEDS_REVIEW`.

## Posting lanes

Two posts go out per week, and which one an event can appear in is decided by
its **category**, not by its score:

| Lane | Post | Categories it may contain |
|---|---|---|
| `monday_campus` | Mon 9:00 — "This Week at FAU" | `campus`, `student_org`, `sports` |
| `thursday_nightlife` | Thu 15:00 — "Weekend Guide" | `nightlife` |

This is a hard partition defined in `packages/core/src/logic/lanes.ts`. Bucket
scores still rank events, but only *within* a lane — no score, tie-break or
manual override can move an event across one. A nightlife promo in the campus
post is worse than posting nothing, so the rule is enforced three times:
`selectEventsForPost` filters by category before scoring, `force_include` is
honoured only for in-lane events (out-of-lane forces are skipped and logged),
and `assertLanePurity` re-checks immediately before anything is written to a
post — throwing rather than shipping a mixed carousel.

**Categories in no lane** (`concert`, `party`, `food_drink`, `career`,
`academic`, …) are deliberately never auto-posted. They still appear in the
events table, tagged `no post`, and can be force-included by hand.

### Pinning a single-purpose source

Some sources only ever produce one kind of event. Posh.vip is nightlife-only,
so it pins its events rather than classifying them one by one:

```sql
UPDATE sources SET metadata = metadata || '{"forceCategory":"nightlife"}'::jsonb
WHERE name = 'Posh.vip Nightlife';
```

This is more accurate than per-event classification *and* it is what guarantees
those events can only reach the nightlife lane — without it, a club promo whose
caption mentions "live music" classifies as `concert`, which belongs to no lane
and would silently drop out of the schedule.

### Applying lane rules to an existing database

Seed data only covers fresh installs. For a database that predates the lanes:

```bash
pnpm worker backfill-lanes FAU --dry-run   # report what would change
pnpm worker backfill-lanes FAU             # apply
```

It prunes schedule slots whose post type no longer has a lane (the retired
midweek post), pins the sources listed above, and recategorizes **and rescores**
their existing events. The rescore matters: an event stored as `concert` carries
a nightlife bucket score computed with the wrong affinity multiplier, so
recategorizing alone would route it correctly but rank it as though it were
still out of place. It's a worker command rather than a SQL migration because
that rescoring needs the real `scoreEvent` logic — porting it to SQL would leave
two copies of the business rule to drift apart. Safe to re-run.

## Orchestration with n8n

Phase 8 (spec §8/§44) — the worker CLI is designed to be the thing n8n calls, not
something n8n reimplements. Each command is a single shell step:

```
┌─────────────────────────┐   daily, per school
│ Cron: 3x/day             │──▶ pnpm worker ingest <school>
└─────────────────────────┘
┌─────────────────────────┐   after each ingestion run
│ Cron: after ingest        │──▶ pnpm worker process <school>
└─────────────────────────┘
┌─────────────────────────┐   weekly (e.g. Sunday night)
│ Cron: weekly              │──▶ pnpm worker select-posts <school>
│                            │──▶ pnpm worker render <postId>   (for each new post)
│                            │──▶ notify the VA (Slack/email) that posts are
│                            │    READY_FOR_APPROVAL
└─────────────────────────┘
┌─────────────────────────┐   after a human clicks Approve in the dashboard
│ Webhook / DB trigger       │──▶ pnpm worker schedule <postId>
└─────────────────────────┘
```

Each node is an "Execute Command" step (`pnpm --filter @college-events/worker start
<command> ...`) against a checked-out copy of this repo with `.env` configured, or a
small HTTP wrapper around the same CLI if you'd rather call it over the network.
Scrape frequency per source (`sources.scrape_frequency_minutes`) is meant to drive
the cron cadence per source category, not a single global interval — see spec §27.
Actual n8n workflow JSON isn't checked in yet since it depends on your n8n instance
and credentials; the CLI contract above is the integration point.

## Testing

```bash
pnpm -r test    # every package's vitest suite, no DB/network required
pnpm -r build   # typecheck + compile everything, including the dashboard
```

83 tests across `core` (dates, scoring, dedup, verification, category assignment,
carousel selection — the business-critical pure logic per spec §38), `ai` (mock
provider extraction + Zod schema validation), `ingestion` (iCal/RSS/JSON-LD
parsing, PhantomBuster mapping), `render` (text shrink-to-fit, real image
generation/dimension checks via Sharp), `scheduler` (mock + Buffer adapter against
a faked `fetch`), and `db` (seed-data referential integrity). None of them require
a live database, AI key, or network call — the mock AI/scheduler providers and
injectable-`fetch` adapters make the whole suite fast and deterministic.

## Deploying

Two Vercel projects: `dashboard` (the Next.js admin UI) and `render-service` (a
standalone Node Function that generates the carousel images — it lives apart from
the dashboard because `sharp`, a native addon, could not be reliably bundled into
Next's serverless output).

**Always deploy with these scripts, never `vercel --prod` on its own:**

```bash
pnpm deploy:render-service
pnpm deploy:dashboard
```

Each one compiles the workspace packages **locally** and then deploys, which is
load-bearing rather than a convenience. The deployed functions import
`@college-events/*` from `packages/*/dist`. Vercel's remote build for these
projects proved unreliable at rebuilding that output, and `dist/` is gitignored —
so with no `.vercelignore` the CLI (which falls back to `.gitignore`) never
uploaded a freshly built copy either. The net effect was a function permanently
frozen on the build from its very first successful deploy: every subsequent
source change deployed cleanly, reported success, and changed nothing, for as
long as the entrypoint file itself still compiled. The root `.vercelignore` now
deliberately *includes* `dist/` in uploads (and excludes `.env` explicitly, since
`.gitignore` no longer governs uploads), and these scripts guarantee that `dist/`
is current before it ships.

To confirm a deploy is actually live and rendering text correctly, the render
service has a self-check that bypasses the whole pipeline and returns a single
letter rendered as base64, plus a build marker:

```bash
curl -s -X POST "$RENDER_SERVICE_URL/api/render" \
  -H "Content-Type: application/json" \
  -H "X-Render-Secret: $RENDER_SERVICE_SECRET" \
  -d '{"diagnostic":true}' -o /tmp/diag.json

node -e "const d=require('/tmp/diag.json');console.log(d.buildMarker);\
require('fs').writeFileSync('/tmp/diag.jpg',Buffer.from(d.imageBase64,'base64'))"
```

If `/tmp/diag.jpg` shows a clean letter, the deployed renderer is healthy. Bump
`BUILD_MARKER` in `apps/render-service/api/render.ts` when you want to prove a
specific build reached production.

## Credentials needed before live deployment

The system runs completely end-to-end today with zero paid credentials (mock AI,
mock scheduler, local file storage). Before going live on real Instagram accounts:

- **Anthropic or OpenAI API key** (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) — real
  event extraction instead of the regex-based mock.
- **PhantomBuster account + agent** — actual Instagram collection. The importer
  contract (`packages/ingestion/src/phantombuster.ts`) is ready for its output.
- **Buffer account + access token + a profile ID per school's Instagram account**
  (`BUFFER_ACCESS_TOKEN`, `BUFFER_PROFILE_ID_<SHORTNAME>`) — real scheduling. Note
  in `packages/scheduler/src/providers/buffer.ts`: verify Buffer's current
  multi-image-carousel request shape against your actual connected Instagram
  Business profile before relying on it — Buffer's API has evolved past the
  legacy single-photo `updates/create` endpoint this MVP targets.
- **Supabase project** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL` pointed at it) — production Postgres + object storage instead of
  local disk. The storage swap is one function (`apps/worker/src/lib/storage.ts`).
- A real `ADMIN_PASSWORD`, and a stronger dashboard auth scheme (Supabase Auth/SSO)
  once more than one operator needs access.

## Troubleshooting

- **`DATABASE_URL` errors / "relation does not exist"** — run `pnpm db:migrate`.
  If you previously ran `pnpm db:reset`, note it also drops drizzle-kit's own
  `drizzle` schema (its migration-tracking table), so a reset always needs a
  fresh `pnpm db:migrate` afterward.
- **Dashboard pages 500 with no useful message** — check `ADMIN_PASSWORD` is set
  (the dashboard fails closed without it) and that `apps/dashboard/.env.local` is a
  symlink to the root `.env` (Next.js doesn't read the monorepo root's `.env` on
  its own).
- **Dashboard build/dev fails with a `sharp`/native-binding error** — this means
  something started importing `@college-events/render` (directly or via the
  `@college-events/worker` barrel export) into a Next.js Server Component/Action.
  Import worker submodules directly (`@college-events/worker/dist/lib/...`) instead
  of the package barrel in dashboard code, and keep rendering behind the
  `runWorkerCommand` subprocess boundary (`apps/dashboard/src/lib/run-worker-command.ts`).
- **A source shows "FAILED LAST N CHECKS" on the dashboard** — check
  `processing_logs` (scope `ingestion`) for the underlying HTTP error; a source's
  `consecutive_failures` resets automatically on its next successful check.
- **An event won't leave `NEEDS_REVIEW`/`CONFLICT`** — by design; the system never
  guesses when sources disagree or when only one low-priority source exists (spec
  §16). Resolve it from the dashboard (edit/approve) or add a corroborating source.
- **`drizzle-kit generate` fails with "Cannot find module './xyz.js'"** — this
  happens if a workspace package's `main` points at raw `.ts` source instead of a
  built `dist/`; every package that `packages/db/src/schema.ts` imports from must be
  built (`pnpm -r build`) before running `generate`.

## What's built vs. what's next

**Built and tested end-to-end (Phases 1-7):** schema + migrations + seed, source
management, ingestion adapters (iCal/RSS/JSON-LD/PhantomBuster/manual), the full AI
extraction → scoring → dedup → verification pipeline (mock provider by default,
real Anthropic/OpenAI providers implemented and ready for a key), weekly post
selection with quality-over-quantity slide rules, deterministic branded rendering,
caption generation, the human approval queue, and the Buffer/mock scheduler.

**Explicitly deferred (non-goals for this MVP, per spec §51 and §44's phased plan):**
advertiser billing/marketplace, a consumer app, follower analytics, a
`npm run add-school` interactive wizard (schema/pipeline already support it — see
above), checked-in n8n workflow JSON (the CLI contract they'd call is done), and a
public event-submission form/DM intake (architecture doesn't block it — manual
entry already proves events can enter the pipeline through a side door).
