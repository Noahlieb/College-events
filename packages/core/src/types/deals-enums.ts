/**
 * Canonical enum values for the Deals product — same "single source of
 * truth" convention as enums.ts for Events. The Postgres pgEnum
 * definitions in @college-events/db must match these arrays.
 */

export const MERCHANT_CATEGORIES = [
  "restaurant",
  "fast_casual",
  "pizza",
  "wings",
  "sushi",
  "coffee_boba",
  "dessert",
  "bar_nightlife",
  "gym_fitness",
  "yoga_pilates",
  "pickleball",
  "barber",
  "hair_salon",
  "nail_salon",
  "tanning",
  "bowling_arcade",
  "movie_theater",
  "escape_room",
  "entertainment_other",
  "student_housing",
  "car_wash_auto",
  "retail",
  "tutoring_test_prep",
  "moving_storage",
  "other",
] as const;
export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];

export const MERCHANT_TIERS = ["A", "B", "C"] as const;
export type MerchantTier = (typeof MERCHANT_TIERS)[number];

/** Where a specific monitored URL sits in a merchant's own site/presence. */
export const DEAL_SOURCE_TYPES = [
  "official_website",
  "promotions_page",
  "menu_page",
  "online_ordering_page",
  "rewards_page",
  "newsletter",
  "instagram",
  "google_business",
  "university_program",
  "manual",
] as const;
export type DealSourceType = (typeof DEAL_SOURCE_TYPES)[number];

export const SCRAPING_METHODS = ["static_fetch", "playwright", "manual"] as const;
export type ScrapingMethod = (typeof SCRAPING_METHODS)[number];

export const DEAL_CATEGORIES = [
  "food_restaurant",
  "coffee_cafe",
  "dessert",
  "fast_casual",
  "pizza_wings",
  "bar_nightlife",
  "fitness",
  "beauty_barber_nails",
  "entertainment",
  "housing",
  "retail_services",
  "other",
] as const;
export type DealCategory = (typeof DEAL_CATEGORIES)[number];

export const FRESHNESS_STATUSES = [
  "new",
  "active",
  "recurring",
  "updated",
  "expiring_soon",
  "expired",
  "unknown",
] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const DEAL_VERIFICATION_STATUSES = [
  "verified",
  "high_confidence",
  "needs_review",
  "stale",
  "rejected",
] as const;
export type DealVerificationStatus = (typeof DEAL_VERIFICATION_STATUSES)[number];

export const CONTENT_ELIGIBILITIES = ["feed_worthy", "story_worthy", "evergreen_library", "reject"] as const;
export type ContentEligibility = (typeof CONTENT_ELIGIBILITIES)[number];

/** Classification of an incoming extracted item against what's already stored. */
export const DEDUP_STATUSES = ["new", "updated", "existing_recurring", "duplicate", "expired"] as const;
export type DedupStatus = (typeof DEDUP_STATUSES)[number];

export const SUBMISSION_SOURCE_TYPES = [
  "scraped",
  "manual",
  "student_submission",
  "business_submission",
  "sponsored",
  "exclusive",
] as const;
export type SubmissionSourceType = (typeof SUBMISSION_SOURCE_TYPES)[number];

export const CONTENT_POST_SLOTS = [
  "monday_top5",
  "tuesday_deal",
  "wednesday_local",
  "friday_weekend",
  "sunday_roundup",
  "story",
] as const;
export type ContentPostSlot = (typeof CONTENT_POST_SLOTS)[number];

export const DEAL_CONTENT_POST_STATUSES = [
  "draft",
  "needs_review",
  "ready_for_approval",
  "approved",
  "scheduled",
  "published",
  "rejected",
] as const;
export type DealContentPostStatus = (typeof DEAL_CONTENT_POST_STATUSES)[number];

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected", "converted_to_deal"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
