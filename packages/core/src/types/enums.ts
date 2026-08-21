/**
 * Canonical enum values shared across db schema, ingestion, AI pipeline,
 * dashboard and rendering. Keep these as the single source of truth —
 * the Postgres pgEnum definitions in @college-events/db must match.
 */

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
