# Multi-University Refactor — Implementation Plan

Written after inspecting the existing FAU MVP. The point of this document is
to record what already exists, so the refactor extends working code instead
of replacing it.

## What the current codebase already gets right

The MVP is closer to the target architecture than a fresh read suggests.
These pieces need **no structural change** — only generalization:

| Target concept | Already implemented as |
|---|---|
| University entity | `schools` table — real multi-tenant row, not a constant |
| RawEvent | `raw_content` — immutable, per-source, one row per observation |
| CanonicalEvent | `events` |
| `event_source_links` | `event_sources` join table (eventId × rawContentId × sourceId) |
| Deduplication | `core/logic/dedup.ts` — bigram title sim + time window + venue/geo/org |
| Merge without losing provenance | `process.ts → mergeIntoExistingEvent()` |
| Graceful source failure | `ingest.ts` — per-source try/catch, `consecutive_failures` |
| Reusable Sidearm adapter | `sidearm.ts` already derives everything from `source.url` |
| Adapter registry | `ingestion/registry.ts` (keyed on `source_type`) |

**Consequence:** the FAU MVP is not a pile of school-specific scrapers with
one exception — Owl Central and Posh reach the database through
`python → CSV → import-csv`. That is the CSV coupling Change #2 targets.

## Deliberate decisions

**1. `schools` stays the table name; it *is* the university entity.**
Renaming to `universities` would touch `schoolId` in ~40 files for zero
functional gain and real regression risk. Instead the table gains the
missing fields (`primary_domain`, `country`, `nightlife_radius_miles`) and
`db` exports `universities` as an alias so new code reads naturally.

**2. `source_type` is retained alongside the new `adapter_type`.**
`source_type` becomes descriptive ("what kind of thing is this") while
`adapter_type` becomes operational ("how do we talk to it"). Splitting them
is the core of Change #1; deleting `source_type` would break the seed,
dashboard filters and `forceCategory` pinning for no benefit.

**3. `priority` is decomposed, not overloaded.**
`trust_score` (whose data wins a merge), `crawl_priority` (queue ordering),
`relevance_bias` (scoring nudge) become distinct columns, backfilled from
the single legacy `priority`.

## Stages

Each stage ends with: `pnpm -r test && pnpm -r lint && pnpm -r build`, then a commit.
Baseline to preserve: **168 tests / 22 files green.**

- **Stage 1 — Foundations.** University fields; adapter-type enum + registry
  keyed on adapter; source schema split (trust/crawl/relevance, health,
  entity ref, config, next_run_at); migration backfilling every existing FAU
  source. FAU must still ingest.
- **Stage 2 — Direct ingestion.** CampusLabs/Engage adapter replacing
  `scrape_owlcentral.py → CSV`. Ingestion service shared by all adapters.
  CSV import demoted to admin-only utility.
- **Stage 3 — Entity graph.** `entities` (organization | venue | promoter)
  + `entity_sources`, so one venue can own website + Posh + Eventbrite rows.
- **Stage 4 — Discovery.** Platform fingerprinting; `source_discovery_candidates`;
  `UniversitySourceDiscoveryService` over a pluggable `WebDiscoveryProvider`
  (mock/fixture provider only — no paid provider hardcoded).
- **Stage 5 — Flyer pipeline.** `asset_candidates` at canonical-event level,
  aggregated across every linked source; official-beats-generated enforced
  in one place and tested.
- **Stage 6 — Jobs & health.** `crawl_jobs` / `source_runs`, scheduler over
  `next_run_at`, health-state transitions incl. yield-drop → WARNING.
- **Stage 7 — Coverage & onboarding.** Coverage metrics incl. discovery miss
  rate; Sources dashboard sections; Add University flow.

## Non-goals / constraints

- No CAPTCHA, Cloudflare, or auth bypass. Posh becomes a **degraded-capable**
  adapter: when challenged it records `DEGRADED` + reason, stops retrying,
  and lets other sources cover the same event.
- No direct Instagram scraping. Social stays a provider-neutral
  `external_social` source fed by an authenticated push endpoint.
- Adapters never name a university. Everything school-specific lives in
  `sources.config`.
