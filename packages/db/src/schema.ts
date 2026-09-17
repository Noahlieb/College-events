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
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  POST_STATUSES,
  POST_TYPES,
  PROCESSING_STATUSES,
  SOURCE_CATEGORIES,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
  MERCHANT_CATEGORIES,
  MERCHANT_TIERS,
  DEAL_SOURCE_TYPES,
  SCRAPING_METHODS,
  DEAL_CATEGORIES,
  FRESHNESS_STATUSES,
  DEAL_VERIFICATION_STATUSES,
  CONTENT_ELIGIBILITIES,
  DEDUP_STATUSES,
  SUBMISSION_SOURCE_TYPES,
  CONTENT_POST_SLOTS,
  DEAL_CONTENT_POST_STATUSES,
  SUBMISSION_STATUSES,
  type BucketScores,
  type EventCategory,
  type EventFieldConfidence,
  type SchoolBranding,
  type WeeklyScheduleSlot,
  type DealQualityBreakdown,
} from "@college-events/core";

// ── enums ──────────────────────────────────────────────────────────
export const sourceTypeEnum = pgEnum("source_type", SOURCE_TYPES);
export const sourceCategoryEnum = pgEnum("source_category", SOURCE_CATEGORIES);
export const eventCategoryEnum = pgEnum("event_category", EVENT_CATEGORIES);
export const processingStatusEnum = pgEnum("processing_status", PROCESSING_STATUSES);
export const verificationStatusEnum = pgEnum("verification_status", VERIFICATION_STATUSES);
export const eventStatusEnum = pgEnum("event_status", EVENT_STATUSES);
export const postTypeEnum = pgEnum("post_type", POST_TYPES);
export const postStatusEnum = pgEnum("post_status", POST_STATUSES);
export const logLevelEnum = pgEnum("log_level", ["debug", "info", "warn", "error"]);

// ── deals enums ────────────────────────────────────────────────────
export const merchantCategoryEnum = pgEnum("merchant_category", MERCHANT_CATEGORIES);
export const merchantTierEnum = pgEnum("merchant_tier", MERCHANT_TIERS);
export const dealSourceTypeEnum = pgEnum("deal_source_type", DEAL_SOURCE_TYPES);
export const scrapingMethodEnum = pgEnum("scraping_method", SCRAPING_METHODS);
export const dealCategoryEnum = pgEnum("deal_category", DEAL_CATEGORIES);
export const freshnessStatusEnum = pgEnum("freshness_status", FRESHNESS_STATUSES);
export const dealVerificationStatusEnum = pgEnum("deal_verification_status", DEAL_VERIFICATION_STATUSES);
export const contentEligibilityEnum = pgEnum("content_eligibility", CONTENT_ELIGIBILITIES);
export const dedupStatusEnum = pgEnum("dedup_status", DEDUP_STATUSES);
export const submissionSourceTypeEnum = pgEnum("submission_source_type", SUBMISSION_SOURCE_TYPES);
export const contentPostSlotEnum = pgEnum("content_post_slot", CONTENT_POST_SLOTS);
export const dealContentPostStatusEnum = pgEnum("deal_content_post_status", DEAL_CONTENT_POST_STATUSES);
export const submissionStatusEnum = pgEnum("submission_status", SUBMISSION_STATUSES);

// ── tenants ────────────────────────────────────────────────────────
export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull().unique(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  timezone: text("timezone").notNull(),
  active: boolean("active").notNull().default(true),
  branding: jsonb("branding").notNull().default({}).$type<SchoolBranding>(),
  defaultRadiusMiles: integer("default_radius_miles").notNull().default(50),
  weeklySchedule: jsonb("weekly_schedule").notNull().default([]).$type<WeeklyScheduleSlot[]>(),
  instagramAccount: text("instagram_account"),
  // ── Deals product fields (spec Phase 1 "University profile") ──────
  studentPopulation: integer("student_population"),
  primaryRadiusMiles: integer("primary_radius_miles").notNull().default(5),
  secondaryRadiusMiles: integer("secondary_radius_miles").notNull().default(7),
  commercialCorridors: jsonb("commercial_corridors").notNull().default([]).$type<string[]>(),
  dealsInstagramAccount: text("deals_instagram_account"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── sources ────────────────────────────────────────────────────────
export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  category: sourceCategoryEnum("category").notNull(),
  url: text("url"),
  instagramHandle: text("instagram_handle"),
  priority: integer("priority").notNull().default(5),
  active: boolean("active").notNull().default(true),
  scrapeFrequencyMinutes: integer("scrape_frequency_minutes").notNull().default(360),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessfulCheckAt: timestamp("last_successful_check_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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

// ════════════════════════════════════════════════════════════════════
// Deals product — a second content engine sharing the same `schools`
// tenant table ("university" = "school"). Every table below carries a
// `universityId` FK to `schools.id` so a new campus is a data change,
// never an application-code change (spec Phase 15).
// ════════════════════════════════════════════════════════════════════

// ── merchant universe ──────────────────────────────────────────────
export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: merchantCategoryEnum("category").notNull(),
  subcategory: text("subcategory"),
  streetAddress: text("street_address"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  distanceFromCampusMiles: real("distance_from_campus_miles").notNull(),
  estimatedDriveTimeMinutes: integer("estimated_drive_time_minutes"),
  website: text("website"),
  instagramUrl: text("instagram_url"),
  onlineOrderingUrl: text("online_ordering_url"),
  specialsUrl: text("specials_url"),
  menuUrl: text("menu_url"),
  rewardsUrl: text("rewards_url"),
  newsletterUrl: text("newsletter_url"),
  discoverySource: text("discovery_source").notNull(),
  studentRelevanceScore: integer("student_relevance_score").notNull().default(50),
  monitoringTier: merchantTierEnum("monitoring_tier").notNull().default("C"),
  active: boolean("active").notNull().default(true),
  dateAdded: timestamp("date_added", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── monitored sources per merchant (1-4 high-value URLs, spec Phase 3) ──
export const merchantSources = pgTable("merchant_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  sourceType: dealSourceTypeEnum("source_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  monitorFrequencyHours: integer("monitor_frequency_hours").notNull().default(24),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
  lastSuccessfulCheckAt: timestamp("last_successful_check_at", { withTimezone: true }),
  contentHash: text("content_hash"),
  active: boolean("active").notNull().default(true),
  scrapingMethod: scrapingMethodEnum("scraping_method").notNull().default("static_fetch"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── changed-content snapshots awaiting extraction (deals equivalent of
// raw_content) — one row per detected change on a merchant_source ──────
export const dealRawContent = pgTable("deal_raw_content", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  merchantSourceId: uuid("merchant_source_id")
    .notNull()
    .references(() => merchantSources.id, { onDelete: "cascade" }),
  universityId: uuid("university_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url"),
  rawText: text("raw_text"),
  contentHash: text("content_hash").notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  processingStatus: processingStatusEnum("processing_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── deals ──────────────────────────────────────────────────────────
export const deals = pgTable("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  // Denormalized from merchants.universityId at write time for query speed
  // (every dashboard filter/aggregate is per-university).
  universityId: uuid("university_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  rawOfferText: text("raw_offer_text"),
  cleanOfferDescription: text("clean_offer_description").notNull(),
  dealCategory: dealCategoryEnum("deal_category").notNull(),
  normalPrice: text("normal_price"),
  dealPrice: text("deal_price"),
  discountPercent: real("discount_percent"),
  discountDollars: real("discount_dollars"),
  isBogo: boolean("is_bogo").notNull().default(false),
  isFreeItem: boolean("is_free_item").notNull().default(false),
  studentIdRequired: boolean("student_id_required").notNull().default(false),
  promoCode: text("promo_code"),
  validDaysOfWeek: jsonb("valid_days_of_week").notNull().default([]).$type<number[]>(),
  startDate: date("start_date"),
  expirationDate: date("expiration_date"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  recurring: boolean("recurring").notNull().default(false),
  recurrencePattern: text("recurrence_pattern"),
  locationRestrictions: text("location_restrictions"),
  minimumPurchase: text("minimum_purchase"),
  eligibility: text("eligibility"),
  sourceUrl: text("source_url"),
  sourceType: dealSourceTypeEnum("source_type").notNull(),
  dateDiscovered: timestamp("date_discovered", { withTimezone: true }).notNull().defaultNow(),
  dateLastVerified: timestamp("date_last_verified", { withTimezone: true }),
  confidenceScore: real("confidence_score").notNull().default(0),
  verificationStatus: dealVerificationStatusEnum("verification_status").notNull().default("needs_review"),
  freshnessStatus: freshnessStatusEnum("freshness_status").notNull().default("unknown"),
  qualityScore: integer("quality_score").notNull().default(0),
  qualityBreakdown: jsonb("quality_breakdown")
    .notNull()
    .default({ studentUsefulness: 0, savingsValue: 0, proximity: 0, freshnessUrgency: 0, shareability: 0, merchantRelevance: 0 })
    .$type<DealQualityBreakdown>(),
  contentEligibility: contentEligibilityEnum("content_eligibility").notNull().default("reject"),
  fingerprint: text("fingerprint").notNull(),
  dedupStatus: dedupStatusEnum("dedup_status").notNull().default("new"),
  submissionSource: submissionSourceTypeEnum("submission_source").notNull().default("scraped"),
  timesUsed: integer("times_used").notNull().default(0),
  lastFeedPostedDate: date("last_feed_posted_date"),
  lastStoryPostedDate: date("last_story_posted_date"),
  lastContentFormat: text("last_content_format"),
  flags: jsonb("flags").notNull().default([]).$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  fingerprintIdx: uniqueIndex("deals_merchant_fingerprint_idx").on(table.merchantId, table.fingerprint),
}));

// ── many-to-many: one national/chain promotion, many eligible campuses ──
// (spec Phase 15 — a Chipotle BOGO shouldn't be duplicated per school).
export const dealUniversities = pgTable(
  "deal_universities",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    universityId: uuid("university_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    distanceMiles: real("distance_miles"),
    nearestLocationAddress: text("nearest_location_address"),
    eligible: boolean("eligible").notNull().default(true),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.dealId, table.universityId] }),
  }),
);

// ── weekly deals content queue (Mon/Tue/Wed/Fri/Sun + Stories) ──────
export const dealContentPosts = pgTable("deal_content_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  slot: contentPostSlotEnum("slot").notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  title: text("title").notNull(),
  caption: text("caption"),
  status: dealContentPostStatusEnum("status").notNull().default("draft"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dealContentPostDeals = pgTable(
  "deal_content_post_deals",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => dealContentPosts.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.postId, table.dealId] }),
  }),
);

// ── verification (spec Phase 11) ─────────────────────────────────────
export const dealVerificationRecords = pgTable("deal_verification_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  verificationStatus: dealVerificationStatusEnum("verification_status").notNull(),
  verificationSource: text("verification_source"),
  verifiedBy: text("verified_by"),
  notes: text("notes"),
});

// ── Instagram performance, fed back into scoring (spec Phase 14) ────
export const dealPerformanceMetrics = pgTable("deal_performance_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  contentPostId: uuid("content_post_id").references(() => dealContentPosts.id, { onDelete: "set null" }),
  platform: text("platform").notNull().default("instagram"),
  reach: integer("reach"),
  views: integer("views"),
  shares: integer("shares"),
  saves: integer("saves"),
  likes: integer("likes"),
  comments: integer("comments"),
  profileVisits: integer("profile_visits"),
  followsGenerated: integer("follows_generated"),
  linkClicks: integer("link_clicks"),
  redemptions: integer("redemptions"),
  revenue: real("revenue"),
  sponsoredRevenue: real("sponsored_revenue"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── student/business/sales submissions (spec Phase 13) ───────────────
export const dealSubmissions = pgTable("deal_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
  submissionType: submissionSourceTypeEnum("submission_type").notNull(),
  submittedBy: text("submitted_by"),
  contactInfo: text("contact_info"),
  rawText: text("raw_text").notNull(),
  status: submissionStatusEnum("status").notNull().default("pending"),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
