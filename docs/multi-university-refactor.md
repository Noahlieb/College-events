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

## What shipped

All seven stages landed. Test count went 168 → 380 across the same suites.

| Stage | What it changed |
|---|---|
| 1 | `adapter_type` split from `source_type`; `priority` decomposed into `trust_score` / `crawl_priority` / `relevance_bias`; health enum with DEGRADED; university fields; every FAU source migrated |
| 2 | `campuslabs` + `posh` adapters; shared ingestion service; CSV demoted to an operator tool; workflow drops Python |
| 3 | `entities` + `entity_sources` with primary/secondary roles; conservative entity resolution |
| 4 | Platform fingerprinting with evidence; `source_discovery_candidates`; `UniversitySourceDiscoveryService` over a pluggable provider |
| 5 | `asset_candidates` at canonical-event level; official-beats-generated in one tested function |
| 6 | `crawl_jobs` / `source_runs`; scheduler over `next_run_at`; failure isolation as a pure, tested function |
| 7 | Coverage metrics incl. discovery miss rate; Sources dashboard sections; Add University flow |

### Adding a university now

1. **Universities → Add university.** Name, short name, domain, city, state, coordinates, timezone.
2. **Sources → Discover sources.** Generates the query set from that record, fingerprints
   results, writes candidates. With no search provider configured this finds nothing — by design.
3. **Review candidates.** Each carries its detected adapter, a confidence, and the evidence.
4. **Approve.** A candidate becomes a source with `next_run_at = null`, so it is due immediately.
5. **`pnpm worker crawl <school>`.** The scheduler queues it alongside everything else.

No step involves writing code.

### Known gaps (updated after the follow-up pass)

The follow-up pass closed most of the original list. What's still true:

- **`external_social` has no push endpoint yet.** The source type, adapter slot and registry
  representation exist; the authenticated ingestion endpoint a future connector would call
  does not.
- **No production `WebDiscoveryProvider` has run against live traffic.** Brave and Google CSE
  are implemented, tested, and selected by `DISCOVERY_PROVIDER` + an API key — but this sandbox
  has neither configured, so nothing here has made a real outbound search call. See the UCF
  validation test for exactly what *was* exercised instead.
- **Two adapter types remain unimplemented by design**: `external_social` (push-only, never
  scraped) and `manual` (hand entry / CSV, not a crawl target). Every other fingerprinted
  platform — 17 of 19 — is now crawlable, tracked by a registry test that fails if a new
  fingerprint rule ships without an adapter to back it.
- **Regeneration triggers are limited to name/category/date.** `artworkInputFingerprint`
  deliberately ignores description and venue changes to avoid discarding an approved image over
  a copy-edit; an operator who wants a refresh for another reason uses `--force`.
- **The discovery-miss probe's date extraction is narrow on purpose.** It reads named/abbreviated
  months and numeric dates from search snippets and returns `null` rather than guess wrong;
  events discovered with no readable date are matched on title similarity alone within the
  probe's lookahead window.

Resolved since the original list: real Brave/Google discovery providers; 17 platform adapters
with an explicit `SUPPORTED / NO_ADAPTER / AUTH_REQUIRED / DEGRADED / BLOCKED / DISABLED` status
model; perceptual hashing (dHash via sharp) with copy-vs-image grouping; full per-source-linked
asset aggregation actually wired into ingestion (it previously wasn't called at all); a real
`EventArtworkGenerator` interface with OpenAI and deterministic implementations behind a
programmatically-enforced gate; a real discovery-miss probe with a run-log denominator and
source recommendations; and a second-university validation suite for UCF.

## Non-goals / constraints## Non-goals / constraints

- No CAPTCHA, Cloudflare, or auth bypass. Posh becomes a **degraded-capable**
  adapter: when challenged it records `DEGRADED` + reason, stops retrying,
  and lets other sources cover the same event.
- No direct Instagram scraping. Social stays a provider-neutral
  `external_social` source fed by an authenticated push endpoint.
- Adapters never name a university. Everything school-specific lives in
  `sources.config`.
