import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ADAPTER_TYPES,
  DISCOVERY_CANDIDATE_STATUSES,
  ENTITY_TYPES,
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  POST_STATUSES,
  POST_TYPES,
  PROCESSING_STATUSES,
  ASSET_CLASSIFICATIONS,
  CRAWL_JOB_STATUSES,
  SOURCE_CATEGORIES,
  SOURCE_HEALTH_STATUSES,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
  type BucketScores,
  type EventCategory,
  type EventFieldConfidence,
  type SchoolBranding,
  type WeeklyScheduleSlot,
} from "@college-events/core";

// ── enums ──────────────────────────────────────────────────────────
export const sourceTypeEnum = pgEnum("source_type", SOURCE_TYPES);
export const assetClassificationEnum = pgEnum("asset_classification", ASSET_CLASSIFICATIONS);
export const crawlJobStatusEnum = pgEnum("crawl_job_status", CRAWL_JOB_STATUSES);
export const adapterTypeEnum = pgEnum("adapter_type", ADAPTER_TYPES);
export const sourceHealthStatusEnum = pgEnum("source_health_status", SOURCE_HEALTH_STATUSES);
export const entityTypeEnum = pgEnum("entity_type", ENTITY_TYPES);
export const discoveryCandidateStatusEnum = pgEnum(
  "discovery_candidate_status",
  DISCOVERY_CANDIDATE_STATUSES,
);
export const sourceCategoryEnum = pgEnum("source_category", SOURCE_CATEGORIES);
export const eventCategoryEnum = pgEnum("event_category", EVENT_CATEGORIES);
export const processingStatusEnum = pgEnum("processing_status", PROCESSING_STATUSES);
export const verificationStatusEnum = pgEnum("verification_status", VERIFICATION_STATUSES);
export const eventStatusEnum = pgEnum("event_status", EVENT_STATUSES);
export const postTypeEnum = pgEnum("post_type", POST_TYPES);
export const postStatusEnum = pgEnum("post_status", POST_STATUSES);
export const logLevelEnum = pgEnum("log_level", ["debug", "info", "warn", "error"]);

// ── universities (tenants) ─────────────────────────────────────────
// Named `schools` for continuity with existing data and ~40 files of
// `schoolId` references; this IS the first-class university entity the
// multi-university architecture is built on, and `universities` is
// exported below as the preferred alias for new code.
export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull().unique(),
  /** Apex domain, e.g. "fau.edu" — the anchor for `site:` discovery queries
   * and for deciding whether a discovered URL is first-party. */
  primaryDomain: text("primary_domain"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  country: text("country").notNull().default("US"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  timezone: text("timezone").notNull(),
  active: boolean("active").notNull().default(true),
  branding: jsonb("branding").notNull().default({}).$type<SchoolBranding>(),
  defaultRadiusMiles: integer("default_radius_miles").notNull().default(50),
  /** How far out to look for nightlife specifically. Separate from
   * defaultRadiusMiles because a commuter school draws nightlife from a
   * wider ring than it draws campus events. */
  nightlifeRadiusMiles: integer("nightlife_radius_miles").notNull().default(25),
  weeklySchedule: jsonb("weekly_schedule").notNull().default([]).$type<WeeklyScheduleSlot[]>(),
  instagramAccount: text("instagram_account"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Preferred alias for new multi-university code. Same table — `schools`
 * predates the multi-tenant vocabulary and is kept as the canonical export
 * so existing queries and `schoolId` foreign keys are untouched.
 */
export const universities = schools;

// ── sources ────────────────────────────────────────────────────────
export const sources = pgTable(
  "sources",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** WHAT this source is (athletics site, venue, watchlist). Descriptive. */
  sourceType: sourceTypeEnum("source_type").notNull(),
  /** HOW we talk to it. The reusable half — one adapter serves every school
   * on that platform. Nullable only during migration; the backfill sets it
   * for every existing row. */
  adapterType: adapterTypeEnum("adapter_type"),
  category: sourceCategoryEnum("category").notNull(),
  url: text("url"),
  /** Where crawling *starts*, when that differs from the source's public
   * home page — an API root, a feed URL, a paginated listing. */
  discoveryUrl: text("discovery_url"),
  instagramHandle: text("instagram_handle"),

  /** The real-world thing that owns this source (venue, org, promoter).
   * Several sources can point at one entity — see `entities`/`entitySources`. */
  entityType: entityTypeEnum("entity_type"),
  entityId: uuid("entity_id"),

  /** Pin every event from this source to a category (e.g. a nightlife
   * promoter feed). Formerly `metadata.forceCategory`. */
  categoryBias: eventCategoryEnum("category_bias"),

  /* ── the three things the old single `priority` column conflated ──
   * They move independently: a scraped city calendar can be low-trust but
   * high-frequency; an official athletics feed is high-trust but rarely
   * needs re-crawling. */
  /** Whose facts win when two sources disagree during a merge. */
  trustScore: integer("trust_score").notNull().default(5),
  /** Queue ordering when more sources are due than we can crawl at once. */
  crawlPriority: integer("crawl_priority").notNull().default(5),
  /** Nudge applied to the relevance score of events from this source. */
  relevanceBias: integer("relevance_bias").notNull().default(0),
  /** Legacy single-meaning column. Retained so historical rows stay
   * readable and any un-migrated caller keeps working; new code reads the
   * three fields above. */
  priority: integer("priority").notNull().default(5),

  active: boolean("active").notNull().default(true),
  crawlIntervalMinutes: integer("crawl_interval_minutes").notNull().default(360),
  /** Legacy name for crawlIntervalMinutes, kept in sync by the backfill. */
  scrapeFrequencyMinutes: integer("scrape_frequency_minutes").notNull().default(360),

  /* ── scheduling + health telemetry ── */
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessfulCheckAt: timestamp("last_successful_check_at", { withTimezone: true }),
  /** Last time this source produced an event we hadn't seen. A source that
   * responds 200 but has stopped yielding is the failure mode that silently
   * shrinks coverage, so it gets its own column. */
  lastEventFoundAt: timestamp("last_event_found_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  healthStatus: sourceHealthStatusEnum("health_status").notNull().default("healthy"),
  /** Human-readable why, for DEGRADED/FAILED. Surfaced on the dashboard so
   * "blocked by an anti-bot challenge" never reads as "broken code". */
  healthReason: text("health_reason"),

  /** Everything school-specific an adapter needs: API host, org id, feed
   * path, page size. Adapters read config; they never name a university. */
  config: jsonb("config").notNull().default({}).$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Same reasoning as source_discovery_candidates' unique index: without
    // this, approving a candidate twice — a slow response and an impatient
    // second click, or a re-discovered candidate re-approved — creates a
    // second source crawling the identical URL, doubling the work and
    // risking duplicate events downstream.
    urlIdx: uniqueIndex("sources_school_url_idx").on(table.schoolId, table.url),
  }),
);

// ── entity graph (organizations, venues, promoters) ───────────────
/**
 * The real-world things that *produce* events, kept separate from the
 * sources that *report* them.
 *
 * The Wharf Fort Lauderdale is one venue with a website, an Instagram, a
 * Posh page and a Tixr page — four sources, one entity. Without this table
 * those four are unrelated rows, and the same night's event arriving from
 * all four looks like four events. With it, they are four observations of
 * one venue's calendar, which is what makes cross-source verification and
 * picking the best flyer possible.
 *
 * One table with a discriminator rather than three: organizations, venues
 * and promoters differ in what they mean, not in what we store or how we
 * query them, and a single table keeps `sources.entity_id` a plain
 * foreign key instead of a polymorphic one.
 */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    name: text("name").notNull(),
    /** Lowercased/punctuation-stripped name, so "The Wharf FTL" and
     * "the wharf ftl" resolve to one entity on insert. */
    normalizedName: text("normalized_name").notNull(),

    website: text("website"),
    /** Profile on the university's engagement platform, for student orgs. */
    engagementProfileUrl: text("engagement_profile_url"),
    instagramHandle: text("instagram_handle"),
    linktreeUrl: text("linktree_url"),
    eventPageUrl: text("event_page_url"),
    ticketingUrl: text("ticketing_url"),

    address: text("address"),
    city: text("city"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),

    active: boolean("active").notNull().default(true),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Scoped per university: two schools can each have a "Student Union".
    nameIdx: uniqueIndex("entities_school_type_name_idx").on(
      table.schoolId,
      table.entityType,
      table.normalizedName,
    ),
  }),
);

/**
 * Which sources belong to which entity. `sources.entity_id` carries the
 * primary owner for fast lookups; this table exists because the
 * relationship is genuinely many-to-many — a city tourism calendar reports
 * events for dozens of venues, and one venue is reported by many feeds.
 */
export const entitySources = pgTable(
  "entity_sources",
  {
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** "primary" = this source is the entity's own channel (its website,
     * its Instagram). "secondary" = a third party that covers it. Only a
     * primary source speaks for the entity when flyers are compared. */
    role: text("role").notNull().default("primary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.entityId, table.sourceId] }),
  }),
);

// ── source discovery candidates ───────────────────────────────────
/**
 * Machine-found URLs that might become sources, held for review.
 *
 * Discovery is a safety net, not an authority. A search provider returning
 * a plausible-looking URL is evidence, not a decision — the wrong URL
 * silently pollutes a university's calendar with another city's events,
 * which is exactly the failure the posh trending-rail incident produced.
 * So candidates land here with their fingerprint and its evidence, and a
 * human (or a high-confidence auto-approval) promotes them to `sources`.
 */
export const sourceDiscoveryCandidates = pgTable(
  "source_discovery_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),

    /** What the fingerprinter thinks this is, and how sure it is. */
    detectedAdapter: adapterTypeEnum("detected_adapter"),
    detectedEntityType: entityTypeEnum("detected_entity_type"),
    confidence: real("confidence").notNull().default(0),
    /** Why we believe it — shown to the reviewer. A bare score is not
     * reviewable; "host matches *.campuslabs.com" is. */
    evidence: jsonb("evidence").notNull().default([]).$type<string[]>(),

    /** How this candidate surfaced: "search", "university_site",
     * "manual", "discovery_miss", "entity_link". */
    discoveryMethod: text("discovery_method").notNull(),
    /** The coverage category this was sought for, e.g. "student_government",
     * "athletics", "nightlife" — lets the coverage report say which parts of
     * a university's ecosystem are still unrepresented. */
    coverageCategory: text("coverage_category"),

    status: discoveryCandidateStatusEnum("status").notNull().default("pending"),
    /** Set when a candidate is promoted, so the same URL is not re-proposed. */
    promotedSourceId: uuid("promoted_source_id").references(() => sources.id, {
      onDelete: "set null",
    }),
    rejectedReason: text("rejected_reason"),

    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => ({
    // One row per URL per university: re-running discovery refreshes a
    // candidate instead of stacking duplicates for a reviewer to wade
    // through, and a rejected URL stays rejected.
    urlIdx: uniqueIndex("discovery_candidate_school_url_idx").on(table.schoolId, table.url),
  }),
);

// ── raw content (immutable discovery record) ──────────────────────
export const rawContent = pgTable(
  "raw_content",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    sourceUrl: text("source_url"),
    rawText: text("raw_text"),
    mediaUrl: text("media_url"),
    localMediaPath: text("local_media_path"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    rawMetadata: jsonb("raw_metadata").notNull().default({}).$type<Record<string, unknown>>(),
    processingStatus: processingStatusEnum("processing_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Primary dedup key: "has this source already produced this external item?"
    sourceExternalIdx: uniqueIndex("raw_content_source_external_idx").on(
      table.sourceId,
      table.externalId,
    ),
  }),
);

// ── normalized events ──────────────────────────────────────────────
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  venue: text("venue"),
  address: text("address"),
  city: text("city"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  price: text("price"),
  ageRequirement: text("age_requirement"),
  category: eventCategoryEnum("category").notNull().default("other"),
  tags: jsonb("tags").notNull().default([]).$type<EventCategory[]>(),
  organization: text("organization"),
  sourceUrl: text("source_url"),
  sourceName: text("source_name"),
  /** Legacy single-image field: whatever the first reporting source had.
   * Retained so existing rows keep rendering; `canonicalAssetId` is what
   * new code reads, because it is chosen across every linked source. */
  sourceImage: text("source_image"),
  originalRawContentId: uuid("original_raw_content_id")
    .notNull()
    .references(() => rawContent.id),
  confidenceScore: real("confidence_score").notNull().default(0),
  fieldConfidence: jsonb("field_confidence").notNull().default({}).$type<EventFieldConfidence>(),
  relevanceScore: integer("relevance_score").notNull().default(0),
  bucketScores: jsonb("bucket_scores")
    .notNull()
    .default({ overall: 0, mondayCampus: 0, midweekActivity: 0, thursdayNightlife: 0 })
    .$type<BucketScores>(),
  verificationStatus: verificationStatusEnum("verification_status").notNull().default("needs_review"),
  status: eventStatusEnum("status").notNull().default("candidate"),
  flags: jsonb("flags").notNull().default([]).$type<string[]>(),
  /** How far asset discovery has got for this event. Explicit because the
   * artwork generator must not run until every linked source has been
   * asked — "no image yet" and "no image anywhere" are different facts,
   * and generating on the first is the bug this pipeline exists to stop. */
  assetDiscoveryStatus: text("asset_discovery_status").notNull().default("pending"),
  assetDiscoveryCompletedAt: timestamp("asset_discovery_completed_at", { withTimezone: true }),
  /** "not_needed" | "pending" | "generated" | "failed". Kept separate from
   * asset discovery so "we have not looked" and "we looked and generated"
   * are distinguishable. */
  generationStatus: text("generation_status").notNull().default("not_needed"),
  /** Fingerprint of the event facts the artwork was generated from.
   * Regeneration happens when this changes — not on every worker run,
   * which would spend money redrawing the same picture nightly. */
  generationInputHash: text("generation_input_hash"),
  /** Why the current selection won, in words, for the review UI. */
  selectedAssetReason: text("selected_asset_reason"),
  /** A reviewer's freeform creative direction ("more blue lighting", "no
   * confetti") for the next AI regeneration of this event's artwork.
   * Deliberately excluded from artworkInputFingerprint — editing this
   * alone must never trigger an unattended regeneration on the next batch
   * run; it only takes effect through the operator's own explicit
   * "Regenerate image" action (force: true). */
  artworkComment: text("artwork_comment"),
  /** An operator's explicit lane pick from the events table, overriding
   * every automatic routing rule (category, the after-9pm rule, weekend
   * sports) — sticks across every future weekly-post rebuild until
   * cleared. Null means "let laneForEvent decide," the default for every
   * event. See packages/core/src/logic/lanes.ts's LaneEvent.manualLane. */
  manualLane: postTypeEnum("manual_lane"),
  /** The winning asset among every candidate from every linked source.
   * Nullable: an event with no artwork anywhere renders a generated
   * placeholder, which is deliberately *not* stored as a candidate so it
   * can never be mistaken for something a source published. */
  canonicalAssetId: uuid("canonical_asset_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── event <-> raw content provenance (many sources can back one event) ──
export const eventSources = pgTable(
  "event_sources",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    rawContentId: uuid("raw_content_id")
      .notNull()
      .references(() => rawContent.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.eventId, table.rawContentId] }),
  }),
);

// ── discovery miss probe: run log ───────────────────────────────────
/**
 * One execution of the broad discovery-miss probe.
 *
 * `discovery_misses` only ever holds unmatched candidates — a matched one
 * is not interesting enough to keep a row for. That means the miss table
 * alone cannot answer "what fraction of what we found did we miss": there
 * is no record of how many *matched*. This is that denominator.
 */
export const discoveryProbeRuns = pgTable("discovery_probe_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  queriesRun: integer("queries_run").notNull(),
  resultsSeen: integer("results_seen").notNull(),
  matched: integer("matched").notNull(),
  recordedAsMisses: integer("recorded_as_misses").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── discovery miss probe ────────────────────────────────────────────
/**
 * One event a broad, independent discovery pass found that our registered
 * sources did not report.
 *
 * This is the measurement behind the discovery miss rate, and it exists
 * because a source registry cannot see its own blind spots — only a
 * second, different look can. A row here is not proof an event was
 * "missed" forever; `matchedEventId` is set if a later crawl or a closer
 * look ties it to a canonical event after all, which is why misses are
 * kept rather than only counted.
 */
export const discoveryMisses = pgTable(
  "discovery_misses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),

    discoveredUrl: text("discovered_url").notNull(),
    eventTitle: text("event_title").notNull(),
    /** Best-effort — search snippets rarely carry a clean date. */
    eventDateGuess: timestamp("event_date_guess", { withTimezone: true }),
    referringProvider: text("referring_provider").notNull(),

    /** Set when the discovered event turns out to belong to a producer we
     * already track — a signal the *source*, not just this one event, is
     * the gap. */
    matchedEntityId: uuid("matched_entity_id").references(() => entities.id, { onDelete: "set null" }),
    /** Set if later evidence ties this to a canonical event after all —
     * at recording time it did not match anything registered sources had
     * reported. */
    matchedEventId: uuid("matched_event_id").references(() => events.id, { onDelete: "set null" }),

    suspectedDomain: text("suspected_domain").notNull(),
    /** Did a source_discovery_candidate for this domain already exist when
     * the miss was recorded? Tells the difference between "we knew about
     * this and haven't gotten to it" and "we had never seen this before". */
    hadExistingCandidate: boolean("had_existing_candidate").notNull().default(false),
    /** Set when repeated misses from this domain triggered a new
     * candidate — see `recommendSourcesFromMisses`. */
    createdCandidateId: uuid("created_candidate_id").references(() => sourceDiscoveryCandidates.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    domainIdx: uniqueIndex("discovery_miss_school_url_idx").on(table.schoolId, table.discoveredUrl),
  }),
);

// ── crawl jobs and run history ────────────────────────────────────
/**
 * One queued crawl of one source.
 *
 * The job table exists so that ingestion stops being a single sequential
 * pass that a slow or hostile source can hold up. A scheduler enqueues
 * what is due; workers claim jobs independently; a failure is recorded
 * against its own job and nothing else. Hundreds of universities means
 * thousands of sources on different intervals, and that only works if the
 * unit of work is one source rather than one nightly script.
 *
 * This is deliberately a table rather than an external queue: at current
 * volume Postgres is the simpler correct answer, and the data model is
 * what has to be right now — the executor can be swapped later without
 * changing what a job *is*.
 */
export const crawlJobs = pgTable("crawl_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  status: crawlJobStatusEnum("status").notNull().default("queued"),
  /** Copied from the source at enqueue time so re-prioritising a source
   * does not reshuffle work already queued. */
  priority: integer("priority").notNull().default(5),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What actually happened on one crawl.
 *
 * Separate from the job because the history is the evidence behind source
 * health: "this source has returned zero events for four runs" is a claim
 * that needs rows to back it, and it is the claim that catches a source
 * failing silently while every run reports success.
 */
export const sourceRuns = pgTable("source_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => crawlJobs.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** "ok" | "no_adapter" | "access_denied" | "error" */
  outcome: text("outcome").notNull(),
  itemsSeen: integer("items_seen").notNull().default(0),
  discovered: integer("discovered").notNull().default(0),
  duplicatesSkipped: integer("duplicates_skipped").notNull().default(0),
  pagesProcessed: integer("pages_processed").notNull().default(0),
  errorMessage: text("error_message"),
  healthAfter: sourceHealthStatusEnum("health_after"),
});

// ── flyer / artwork candidates ────────────────────────────────────
/**
 * Every image any source offered for an event, kept as candidates so the
 * best one can be chosen — and re-chosen — across all of them.
 *
 * This lives at the *canonical event* level on purpose. The bug it exists
 * to prevent is subtle: one source reports an event with no image, the
 * renderer sees nothing and generates a placeholder, while a second source
 * reporting the same event had the promoter's actual flyer the whole time.
 * Per-source artwork cannot see that; per-event artwork can.
 *
 * Candidates are never deleted when a better one arrives. Provenance is
 * the point — which source offered which image is how a wrong flyer gets
 * traced back later.
 */
export const assetCandidates = pgTable(
  "asset_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Which source offered it, and in which observation. */
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    rawContentId: uuid("raw_content_id").references(() => rawContent.id, { onDelete: "set null" }),

    sourceUrl: text("source_url").notNull(),
    /** Set once we have copied it into our own storage. */
    storageUrl: text("storage_url"),
    width: integer("width"),
    height: integer("height"),
    mime: text("mime"),
    /** Perceptual hash — lets the same flyer arriving from three sources be
     * recognised as one image rather than three, and lets a higher-res copy
     * be spotted as the *same* artwork rather than a different one. */
    perceptualHash: text("perceptual_hash"),
    /** Encoded file size. The last tie-breaker between copies of identical
     * dimensions — the larger file is the less-compressed one. */
    bytes: integer("bytes"),

    classification: assetClassificationEnum("classification").notNull().default("unknown"),
    /** True only when the offering source is authoritative for this event. */
    isOfficial: boolean("is_official").notNull().default(false),
    isAiGenerated: boolean("is_ai_generated").notNull().default(false),
    confidence: real("confidence").notNull().default(0),
    /** Where in the page it came from: jsonld, opengraph, hero, api, … */
    origin: text("origin"),

    /* ── provenance for artwork we made ourselves ──
     * Stored so "why does this event have generated art" is answerable
     * months later without re-deriving it. */
    generationProvider: text("generation_provider"),
    generationModel: text("generation_model"),
    generationPrompt: text("generation_prompt"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // The same image offered twice by one source is one candidate.
    uniqueIdx: uniqueIndex("asset_candidate_event_url_idx").on(table.eventId, table.sourceUrl),
  }),
);

// ── weekly posts (carousels) ─────────────────────────────────────────
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  postType: postTypeEnum("post_type").notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  title: text("title").notNull(),
  caption: text("caption"),
  status: postStatusEnum("status").notNull().default("draft"),
  schedulerId: text("scheduler_id"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const postEvents = pgTable(
  "post_events",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    slideNumber: integer("slide_number").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.postId, table.eventId] }),
  }),
);

export const renderedAssets = pgTable("rendered_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  storageUrl: text("storage_url").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  template: text("template").notNull(),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const processingLogs = pgTable("processing_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").references(() => schools.id, { onDelete: "cascade" }),
  level: logLevelEnum("level").notNull().default("info"),
  scope: text("scope").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
