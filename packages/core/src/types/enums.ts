/**
 * Canonical enum values shared across db schema, ingestion, AI pipeline,
 * dashboard and rendering. Keep these as the single source of truth —
 * the Postgres pgEnum definitions in @college-events/db must match.
 */

/**
 * ADAPTER TYPES — *how* we talk to a platform, independent of any school.
 *
 * This is the reusable half of the source model: one adapter serves every
 * university running that platform. `campuslabs` works for FAU's Owl Central
 * and UCF's Knight Connect alike; the school-specific host/org id lives in
 * `sources.config`, never in adapter code.
 *
 * Distinct from SOURCE_TYPES below, which describes *what a source is*
 * (athletics site, venue, watchlist) rather than how it is fetched.
 */
export const ADAPTER_TYPES = [
  // Campus event platforms
  "campuslabs", // Anthology/CampusLabs Engage (Owl Central, Knight Connect, ...)
  "campusgroups",
  "localist",
  "25live", // CollegeNET Series25
  "sidearm", // SIDEARM Sports athletics sites
  // Generic structured formats
  "rss",
  "ical",
  "google_calendar",
  "jsonld",
  "wordpress",
  // Ticketing / nightlife platforms
  "eventbrite",
  "posh",
  "partiful",
  "luma",
  "ticketmaster",
  "tixr",
  // Fallbacks and non-crawled inputs
  "generic_web",
  "external_social", // pushed in by an authorized connector; never scraped here
  "manual",
] as const;
export type AdapterType = (typeof ADAPTER_TYPES)[number];

/**
 * Operational health of a source instance. DEGRADED specifically means
 * "this source is reachable in principle but is refusing automated access
 * right now" (e.g. an anti-bot challenge) — it is not a bug to fix by
 * trying harder, and it must never fail the wider ingestion run.
 */
export const SOURCE_HEALTH_STATUSES = [
  "healthy",
  "warning", // still responding, but yield looks wrong (see source health rules)
  "degraded", // access denied/challenged — back off, let other sources cover
  "failed",
  "disabled",
] as const;
export type SourceHealthStatus = (typeof SOURCE_HEALTH_STATUSES)[number];

/** Real-world things that own sources. One venue may have 4 sources. */
export const ENTITY_TYPES = ["organization", "venue", "promoter", "department", "university"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Review lifecycle for a machine-discovered source candidate. */
export const DISCOVERY_CANDIDATE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "auto_approved",
] as const;
export type DiscoveryCandidateStatus = (typeof DISCOVERY_CANDIDATE_STATUSES)[number];

/**
 * What an image actually is. The distinction that matters is between art
 * made *for this event* and art that merely appears near it — an
 * organization's logo is not a flyer, and treating it as one would give
 * every club meeting a "flyer" that is really just the club's badge.
 */
export const ASSET_CLASSIFICATIONS = [
  "flyer", // purpose-made promotional art for this event
  "event_art", // official imagery for the event, not a flyer per se
  /** A picture of the room, not of the event. Real, useful as a last
   * resort before generating, but it says nothing about *this* night. */
  "venue_photo",
  /** A platform's default share card, a stock header, an org banner —
   * imagery attached to the page rather than to the event. */
  "generic_social_image",
  "photo", // legacy: pre-dates the venue/social split
  "logo", // organization/venue branding — never event-specific
  "generated", // produced by us when nothing official exists
  "unknown",
] as const;
export type AssetClassification = (typeof ASSET_CLASSIFICATIONS)[number];

/** Lifecycle of one queued crawl of one source. */
export const CRAWL_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped", // source disabled or removed between enqueue and run
] as const;
export type CrawlJobStatus = (typeof CRAWL_JOB_STATUSES)[number];

/**
 * Whether we can actually crawl a platform, as distinct from whether a
 * particular source is healthy.
 *
 * Fingerprinting can confidently identify a platform we have no adapter
 * for. Showing that source as "active" would be a lie — it will never
 * produce an event — and showing it as "failed" would be a different lie,
 * blaming the source for a gap on our side. Both states are real and they
 * need different words.
 */
export const ADAPTER_SUPPORT_STATUSES = [
  /** An adapter exists and can crawl this source now. */
  "supported",
  /** Platform identified, but nothing here can read it yet. Our gap. */
  "no_adapter",
  /** An adapter exists but needs a credential this deployment lacks. */
  "auth_required",
  /** Reachable, but the platform is declining automated access right now. */
  "degraded",
  /** The platform has refused access persistently enough to stop asking. */
  "blocked",
  /** Deliberately switched off by an operator. */
  "disabled",
] as const;
export type AdapterSupportStatus = (typeof ADAPTER_SUPPORT_STATUSES)[number];

export const SOURCE_TYPES = [
  "instagram",
  "owl_central",
  "university_calendar",
  "athletics",
  "eventbrite",
  "venue_website",
  "ticketing_website",
  "rss",
  "ical",
  "generic_webpage",
  "manual_submission",
  "other_api",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_CATEGORIES = [
  "campus",
  "nearby",
  "instagram_watchlist",
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const EVENT_CATEGORIES = [
  "campus",
  "student_org",
  "sports",
  "concert",
  "nightlife",
  "party",
  "food_drink",
  "fitness",
  "comedy",
  "festival",
  "career",
  "academic",
  "networking",
  "community",
  "dating",
  "other",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const PROCESSING_STATUSES = [
  "pending",
  "processing",
  "processed",
  "rejected",
  "error",
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  "verified",
  "high_confidence",
  "needs_review",
  "conflict",
  "rejected",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const EVENT_STATUSES = [
  "candidate", // freshly extracted, not yet reviewed
  "active", // eligible for post selection
  "selected", // placed into a post
  "published", // post containing it went live
  "expired",
  "rejected",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const POST_TYPES = [
  "monday_campus",
  /** Legacy. No weekly schedule slot produces this any more (see
   * logic/lanes.ts — the two remaining lanes are campus and nightlife), but
   * the value must stay in the pgEnum so historical rows remain readable. */
  "midweek_activities",
  "thursday_nightlife",
  "custom",
] as const;
export type PostType = (typeof POST_TYPES)[number];

export const POST_STATUSES = [
  "draft",
  "needs_review",
  "ready_for_approval",
  "approved",
  "scheduled",
  "published",
  "rejected",
  "error",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
