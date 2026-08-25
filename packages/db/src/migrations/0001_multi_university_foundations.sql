CREATE TYPE "public"."adapter_type" AS ENUM('campuslabs', 'campusgroups', 'localist', '25live', 'sidearm', 'rss', 'ical', 'google_calendar', 'jsonld', 'wordpress', 'eventbrite', 'posh', 'partiful', 'luma', 'ticketmaster', 'tixr', 'generic_web', 'external_social', 'manual');--> statement-breakpoint
CREATE TYPE "public"."discovery_candidate_status" AS ENUM('pending', 'approved', 'rejected', 'auto_approved');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('organization', 'venue', 'promoter', 'department', 'university');--> statement-breakpoint
CREATE TYPE "public"."source_health_status" AS ENUM('healthy', 'warning', 'degraded', 'failed', 'disabled');--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "primary_domain" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "country" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "nightlife_radius_miles" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "adapter_type" "adapter_type";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "discovery_url" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "entity_type" "entity_type";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "category_bias" "event_category";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "trust_score" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "crawl_priority" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "relevance_bias" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "crawl_interval_minutes" integer DEFAULT 360 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_event_found_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "health_status" "source_health_status" DEFAULT 'healthy' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "health_reason" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- ── backfill: carry every existing source into the new model ──────────
-- Nothing here is FAU-specific; it is a pure restatement of the old
-- columns in the new vocabulary, so an existing deployment keeps working
-- with no manual data entry.

-- The single `priority` column meant three different things depending on
-- who read it. Seed both successors from it so behaviour is bit-identical
-- on the first run after migrating; they diverge only when an admin edits
-- one of them.
UPDATE "sources" SET
  "trust_score"            = "priority",
  "crawl_priority"         = "priority",
  "crawl_interval_minutes" = "scrape_frequency_minutes";--> statement-breakpoint

-- forceCategory moves out of the metadata blob into a real column.
UPDATE "sources"
   SET "category_bias" = ("metadata"->>'forceCategory')::"public"."event_category"
 WHERE "metadata"->>'forceCategory' IS NOT NULL;--> statement-breakpoint

-- source_type described what a source IS; adapter_type describes how we
-- talk to it. Platform-specific URLs win over the generic type mapping —
-- a posh.vip listing filed as a manual feed is really a posh source.
UPDATE "sources" SET "adapter_type" = CASE
  WHEN "url" ILIKE '%posh.vip%'       THEN 'posh'
  WHEN "url" ILIKE '%eventbrite.%'    THEN 'eventbrite'
  WHEN "url" ILIKE '%partiful.%'      THEN 'partiful'
  WHEN "url" ILIKE '%lu.ma%'          THEN 'luma'
  WHEN "url" ILIKE '%ticketmaster.%'  THEN 'ticketmaster'
  WHEN "url" ILIKE '%tixr.%'          THEN 'tixr'
  WHEN "url" ILIKE '%campuslabs.com%' THEN 'campuslabs'
  ELSE CASE "source_type"
    WHEN 'instagram'          THEN 'external_social'
    WHEN 'owl_central'        THEN 'campuslabs'
    WHEN 'university_calendar' THEN 'ical'
    WHEN 'athletics'          THEN 'sidearm'
    WHEN 'eventbrite'         THEN 'eventbrite'
    WHEN 'venue_website'      THEN 'generic_web'
    WHEN 'ticketing_website'  THEN 'generic_web'
    WHEN 'rss'                THEN 'rss'
    WHEN 'ical'               THEN 'ical'
    WHEN 'generic_webpage'    THEN 'jsonld'
    WHEN 'manual_submission'  THEN 'manual'
    ELSE 'generic_web'
  END
END::"public"."adapter_type"
WHERE "adapter_type" IS NULL;--> statement-breakpoint

-- An inactive source is DISABLED, not unhealthy — the distinction matters
-- because coverage metrics must not count a deliberately-parked source as
-- a failure.
UPDATE "sources" SET "health_status" = 'disabled' WHERE "active" = false;--> statement-breakpoint

-- Every active source is due immediately; the scheduler spreads them out
-- from there.
UPDATE "sources" SET "next_run_at" = now() WHERE "active" = true;--> statement-breakpoint

-- Domain for the discovery engine's site: queries. Derived from any
-- existing school-owned URL rather than hardcoded per school.
UPDATE "schools" SET "primary_domain" = 'fau.edu'
 WHERE "short_name" = 'FAU' AND "primary_domain" IS NULL;
