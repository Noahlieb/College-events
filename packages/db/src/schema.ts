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
  type BucketScores,
  type EventCategory,
  type EventFieldConfidence,
  type SchoolBranding,
  type WeeklyScheduleSlot,
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
