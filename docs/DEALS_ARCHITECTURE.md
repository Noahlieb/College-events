# College Deals Intelligence System — Architecture

A second product line inside this monorepo, alongside the existing Events
engine. It discovers real, time-sensitive deals at businesses near a
campus, extracts and scores them, remembers what's already been used, and
assembles a weekly Instagram content queue — with a human approval step
before anything goes out. **First campus: UCF.** Multi-tenant from day
one: every deals table carries a `university_id`, so a second, tenth, or
fiftieth campus is a data change, not a rewrite.

```
MERCHANT DISCOVERY → SOURCE MONITORING → CHANGE DETECTION → AI EXTRACTION →
DEDUP/FINGERPRINT → QUALITY SCORE → CONTENT ELIGIBILITY → VERIFICATION →
WEEKLY CONTENT QUEUE → HUMAN APPROVAL → SCHEDULER → INSTAGRAM
                                    ↘ PERFORMANCE METRICS feed back into scoring
```

## 1. System architecture

This reuses the monorepo's existing shape rather than inventing a parallel
stack: pure domain logic in provider-agnostic packages, two thin apps wire
them together. The Events product's `schools` table already *is* the
"Universities" table the spec asks for (name, short name, city/state,
lat/lng, timezone, Instagram account, radius) — UCF is added as a second
row in that same table rather than duplicating a tenant concept. New
deals-specific fields (`studentPopulation`, `primaryRadiusMiles`,
`secondaryRadiusMiles`, `commercialCorridors`, `dealsInstagramAccount`) are
added as columns on that same table. Every new table below references
`schools.id` through a column named `universityId` for domain clarity.

```
packages/
  core        + deals enums/types, deal-scoring, deal-dedup (fingerprinting),
              deal-freshness (status machine), deal-content-queue (weekly
              slot assignment — the deals equivalent of lanes.ts). Pure,
              unit-tested, no I/O.
  db          + merchants, merchantSources, deals, dealUniversities,
              contentPosts/contentPostDeals (deals-scoped), verificationRecords,
              performanceMetrics, submissions tables on the same Postgres DB.
  ai          AIProvider gains extractDeal() — same interface, same
              Anthropic/OpenAI/Mock providers, one more structured-output
              method.
  ingestion   + a static-fetch webpage source adapter with content hashing
              for change detection (packages/ingestion/src/deal-source.ts).
  scheduler   unchanged — reused as-is for posting.

apps/
  worker      + deals-pipeline/: ingest-merchant-sources (poll + hash),
              process-deals (extract → score → dedupe → freshness),
              generate-content-queue (weekly Mon/Tue/Wed/Fri/Sun queue).
  dashboard   + /deals (per-university summary) and /deals/queue (weekly
              content queue + approval), same auth/middleware.
```

Why bolt onto the existing repo instead of a new service: the hard parts
(multi-tenant schema, an `AIProvider` abstraction, mock-first pipelines
that run with zero paid credentials, a worker-CLI-as-integration-point,
Postgres via Drizzle, the dashboard's auth/rendering boundary) are already
built, tested, and proven for a structurally identical problem — poll
sources → structured-extract → dedupe → score → assemble weekly posts →
human-approve → schedule. Deals swaps "events" for "deals" and adds a
quality-score/eligibility layer (Phases 7-8) and a fingerprint-based
repetition memory (Phase 6) that events didn't need, but the skeleton is
the same code shape, not a new architecture.

## 2. Database schema

All new tables live in `packages/db/src/schema.ts` next to the existing
ones, Drizzle ORM, Postgres.

```
schools (existing, extended)
  + student_population int null
  + primary_radius_miles int default 5
  + secondary_radius_miles int default 7
  + commercial_corridors jsonb string[] default []
  + deals_instagram_account text null

merchants
  id, university_id → schools.id, name, category, subcategory,
  street_address, latitude, longitude, distance_from_campus_miles (computed
  on write), estimated_drive_time_minutes, website, instagram_url,
  online_ordering_url, specials_url, menu_url, rewards_url, newsletter_url,
  discovery_source, student_relevance_score int, monitoring_tier enum(A/B/C),
  active bool, date_added, created_at, updated_at

merchant_sources                          -- "Sources" table, spec §Phase 3
  id, merchant_id → merchants.id, source_type enum, source_url,
  monitor_frequency_hours, last_checked_at, last_changed_at,
  last_successful_check_at, content_hash, active, scraping_method
  enum(static_fetch/playwright/manual), notes

deals
  id, merchant_id → merchants.id, university_id → schools.id (denormalized
  for query speed — always merchant.university_id at write time),
  title, raw_offer_text, clean_offer_description, deal_category,
  normal_price, deal_price, discount_percent, discount_dollars,
  is_bogo, is_free_item, student_id_required, promo_code,
  valid_days_of_week jsonb int[] (0=Sun), start_date, expiration_date,
  start_time, end_time, recurring bool, recurrence_pattern,
  location_restrictions, minimum_purchase, eligibility,
  source_url, source_type, date_discovered, date_last_verified,
  confidence_score real, verification_status enum, freshness_status enum,
  quality_score int, quality_breakdown jsonb, content_eligibility enum
  (feed_worthy/story_worthy/evergreen_library/reject),
  fingerprint text (indexed) — merchant+offer+price+day+code+location hash,
  dedup_status enum(new/updated/existing_recurring/duplicate/expired),
  submission_source enum(SCRAPED/MANUAL/STUDENT_SUBMISSION/
  BUSINESS_SUBMISSION/SPONSORED/EXCLUSIVE),
  times_used int default 0, last_feed_posted_date, last_story_posted_date,
  last_content_format, flags jsonb string[], created_at, updated_at

deal_universities                         -- many-to-many for national/chain
  deal_id → deals.id, university_id → schools.id, distance_miles,
  nearest_location_address, eligible bool
  -- lets one Chipotle BOGO promotion become eligible at UCF, FAU, FSU,
  -- UF... without duplicating the underlying deal row. Single-location
  -- local deals just use deals.universityId directly and never populate
  -- this table.

content_posts (deals)                     -- separate from events' `posts`
  id, university_id, slot enum(monday_top5/tuesday_deal/wednesday_local/
  friday_weekend/sunday_roundup/story), scheduled_date, title, caption,
  status enum(draft/needs_review/ready_for_approval/approved/scheduled/
  published/rejected), approved_by, approved_at, created_at, updated_at

content_post_deals
  post_id → content_posts.id, deal_id → deals.id, position

verification_records
  id, deal_id, verified_at, verification_status, verification_source,
  verified_by, notes

performance_metrics
  id, deal_id, content_post_id null, platform default 'instagram', reach,
  views, shares, saves, likes, comments, profile_visits,
  follows_generated, link_clicks, redemptions, revenue, sponsored_revenue,
  recorded_at

submissions
  id, university_id, merchant_id null, submission_type enum(STUDENT_
  SUBMISSION/BUSINESS_SUBMISSION/SPONSORED/EXCLUSIVE), submitted_by,
  contact_info, raw_text, status enum(pending/approved/rejected/
  converted_to_deal), deal_id null, created_at
```

`processing_logs` (existing) is reused as-is for deals ingestion/AI
failures — it's already generic (`school_id`, `scope`, `message`).

## 3. Merchant discovery methodology

Ranked, not exhaustive. For UCF: start from category quotas (food/
restaurants 60–70%, fitness 5–10%, beauty 5–10%, entertainment 5–10%,
housing 5–10%, misc remainder), pull candidates from (a) known
high-traffic corridors around campus (University Blvd, Alafaya Trail,
Waterford Lakes, UCF Plaza/Knights Plaza-type retail centers), (b) Google
Maps category search seeded from those corridors, (c) discovery search
queries (Phase 12 — "UCF food deals," "UCF Taco Tuesday," etc.), (d)
manual local knowledge / existing "near UCF" listicles as leads only,
always re-verified against the business's own site before entry. Every
candidate gets `distanceFromCampus` computed via haversine against UCF's
coordinates and a `studentRelevanceScore` (category baseline + proximity +
promo-history signal, *not* follower count), then a tier:

- **Tier A** — high relevance, within ~2 miles, promo-heavy category
  (wings/pizza/boba/fast-casual/gyms with intro offers) → checked daily.
- **Tier B** — relevant, 2–5 miles or less promo-heavy → 2–3×/week.
- **Tier C** — useful but peripheral, up to the secondary radius → weekly.

Distance is weighted heavily but not a hard cutoff — the same decay-tier
approach as `core/logic/geo.ts` (`geoScore`), re-tuned for a 5–7 mile deals
radius instead of Boca-to-Miami event geography.

## 4. Scraping / source strategy

Per merchant, 1–4 high-value URLs, never a full-site crawl: official
specials/promo page, menu/ordering page (Toast/Square often embed current
promos), rewards/newsletter signup page, public Instagram bio link.
Preference order: official page with static HTML > JSON-LD/structured data
(reusing `extractJsonLdEvents`-style parsing where a business happens to
publish `Offer` schema) > plain text scrape of a static page > flag
`MANUAL_SOURCE` and stop.

**Change detection first, LLM second** (Phase 4): fetch → strip
boilerplate (nav/footer/script) → normalize whitespace → SHA-256 hash →
compare to `merchant_sources.content_hash`. Unchanged → stop, no LLM call.
Changed → diff-worthy text goes to `extractDeal()`. Recurring offers
(Taco Tuesday, etc.) are re-checked on a slower cadence even when
unchanged, since they remain valid inventory (spec's explicit carve-out).

**What this MVP does *not* do**: defeat CAPTCHAs, logins, paywalls, or
bot-detection; crawl JS-rendered SPA specials pages (flagged
`MANUAL_SOURCE` instead of adding Playwright for the MVP — see Risks);
follow pagination/history — only the current state of a small, named set
of URLs per merchant.

## 5. Deal Quality Score (0–100)

```
score = studentUsefulness*0.25 + savingsValue*0.20 + proximity*0.15
      + freshnessUrgency*0.15 + shareability*0.15 + merchantRelevance*0.10
```

- **studentUsefulness** — category baseline (food/drink/entertainment high,
  obscure retail low), boosted for free/BOGO/percent-off-meal-sized offers.
- **savingsValue** — from discount_percent/discount_dollars/BOGO/free_item
  when known; a flat baseline when unknown (never invents a number).
- **proximity** — same decay curve as events' `geoScore`, re-tuned to a
  0–7mi band (0.5mi ≫ 7mi, per spec).
- **freshnessUrgency** — NEW/EXPIRING_SOON score highest, ACTIVE/RECURRING
  moderate, evergreen/UNKNOWN-expiration lowest of the "still valid" tier.
- **shareability** — starts as a category/format heuristic (free food, BOGO,
  giveaways score high; permanent %-off-with-ID scores low), then blends in
  `performance_metrics` history for similar past deals once that data
  exists (Phase 14 — starts as a prior, becomes learned).
- **merchantRelevance** — the merchant's own `student_relevance_score`.

All six weights and every sub-curve are named constants in
`packages/core/src/logic/deal-scoring.ts`, overridable via options —
matching how `scoreEvent`'s bucket-affinity tables work today.

**Content eligibility** thresholds (configurable, spec §Phase 8 numbers as
defaults): 80–100 → priority feed, 65–79 → feed candidate, 50–64 → story/
roundup candidate, <50 → reject. A deal is additionally suppressed from
FEED (downgraded to STORY-eligible) if: the same fingerprint was used in a
feed post in the last 4–6 weeks, the merchant already has an active post
this week, or it's evergreen/UNKNOWN-expiration (evergreen deals default to
roundup-only placement, never a standalone feed slot, per the 60–70/20–30/
10–20 content-mix target). This mirrors `lanes.ts`'s pattern: one pure
function decides eligibility, selection code never re-derives the rule.

## 6. UCF MVP implementation plan (Phase 19, scoped for this session)

1. Schema + migration (this session).
2. UCF `schools` row (this session).
3. ~30 real/plausible UCF-area merchants across the required category mix
   as a first tranche toward 50–150 — see Risk #1 below for how this scales.
4. 1–3 sources per merchant, `merchant_sources` rows.
5. `deals:ingest` — fetch + hash + change detection.
6. `deals:process` — mock-provider extraction (deterministic, zero-key,
   same philosophy as `MockAIProvider`) → fingerprint/dedupe → score →
   freshness → content eligibility, real Anthropic/OpenAI provider wired
   the same way events already are (`AI_PROVIDER` env var).
7. `deals:queue` — builds the Mon/Tue/Wed/Fri/Sun weekly structure from
   `active`, feed/story-eligible deals, respecting the repetition-window
   rule.
8. `/deals` and `/deals/queue` dashboard views (Phase 16 fields).
9. `pnpm deals:demo` end-to-end, seeded with representative pending
   merchant-source content so the pipeline is provably exercised without
   live network access.

The two-week live-run measurement task (how many merchants are actually
needed for ≥20 non-repetitive deals/month) is an operational task for
*after* this MVP ships and runs against real source URLs — this session
delivers the instrumented system that produces that measurement, not the
two weeks of wall-clock data itself.

## 7. Stack

Unchanged from the existing repo, extended in place: TypeScript/Node 22,
pnpm workspaces, Postgres via Drizzle ORM (Supabase-compatible), Zod for
structured LLM output schemas, native `fetch` for static HTML sources (no
new HTTP dependency needed for MVP-scope static pages), Next.js for the
dashboard, Vitest for tests. Playwright is intentionally *not* added yet
(see Risks) — the spec allows it "only when genuinely necessary," and no
MVP-tranche merchant source requires it.

## 8. Repository/folder structure

No new top-level layout — deals code is interleaved into the existing
package boundaries, same convention as events:

```
packages/core/src/{types,logic}/deal-*.ts
packages/db/src/schema.ts               (extended)
packages/db/src/seed/deals-data.ts      (new)
packages/ai/src/{schemas,types}.ts      (extended)
packages/ingestion/src/deal-source.ts   (new)
apps/worker/src/deals-pipeline/*.ts     (new)
apps/worker/src/cli.ts                  (extended: deals:* commands)
apps/dashboard/src/app/deals/**         (new)
docs/DEALS_ARCHITECTURE.md              (this file)
```

## 9. Risks / limitations and handling

- **Merchant data currency.** Hours, menus, and promos change without
  notice; addresses/coordinates here are a best-effort starting tranche,
  not verified against a paid geocoding/places API (none is configured).
  Handling: every merchant/source is flagged `active`/`monitoring_tier`
  and re-checked on its tier cadence; a source that 404s or a merchant that
  looks closed should be deactivated from the dashboard, not deleted
  (matches events' `consecutive_failures` pattern).
- **JS-rendered specials pages.** Several real chains render promos
  client-side. Rather than add Playwright now (more infra, more failure
  modes, against the spec's "only when genuinely necessary"), these are
  seeded as `scraping_method: manual` sources — visible in the dashboard as
  needing a human glance, not silently skipped.
- **LLM extraction accuracy / hallucination.** Mitigated the same way
  events' pipeline is: nullable-only structured output (`ExtractedDeal`),
  never invent an expiration/price, `UNKNOWN` is a first-class value, and a
  confidence floor routes low-confidence extractions to `needs_review`
  instead of auto-publishing.
- **Dedup false positives/negatives.** The fingerprint (merchant + offer
  category + price + day + promo code + location) is deliberately coarse
  enough to catch "Taco Tuesday" showing up every week, but a genuinely
  new offer at a merchant that already has a recurring deal must still
  read as NEW — handled by including offer_category+price in the
  fingerprint, not just merchant name (mirrors `areDuplicates`' "false
  merge is worse than a missed one" stance from the events dedup logic).
- **Compliance.** No CAPTCHA/login/rate-limit bypass, ever — a source that
  needs one is `MANUAL_SOURCE`, full stop, matching Phase 3's explicit
  instruction.
- **Cold-start data.** Real merchant hours/current promos require a live
  network fetch this session's research budget can't fully verify for 30+
  businesses; seed data is marked with `discoverySource: "seed-research"`
  and should be spot-checked before the first live posting cycle.

## 10. First working milestone

Running `pnpm --filter @college-events/worker start deals:demo UCF` after
`pnpm db:seed:deals` will, end-to-end and with zero paid credentials:
seed UCF plus its first merchant tranche and sources, run change detection
over the seeded pending source content, extract structured deals via the
mock AI provider, fingerprint/dedupe them against nothing (first run) and
against each other, score and classify each into feed/story/evergreen/
reject, and assemble a proposed weekly content queue (Monday Top 5,
Tuesday deal, Wednesday local deal, Friday weekend deal, Sunday roundup)
in `draft` status — visible on `/deals` and `/deals/queue` in the
dashboard for human review. Nothing is posted automatically; the approval
gate matches the events product's `approve`/`reject` pattern.
