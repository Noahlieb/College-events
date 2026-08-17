CREATE TYPE "public"."event_category" AS ENUM('campus', 'student_org', 'sports', 'concert', 'nightlife', 'party', 'food_drink', 'fitness', 'comedy', 'festival', 'career', 'academic', 'networking', 'community', 'dating', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('candidate', 'active', 'selected', 'published', 'expired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'needs_review', 'ready_for_approval', 'approved', 'scheduled', 'published', 'rejected', 'error');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('monday_campus', 'midweek_activities', 'thursday_nightlife', 'custom');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'processed', 'rejected', 'error');--> statement-breakpoint
CREATE TYPE "public"."source_category" AS ENUM('campus', 'nearby', 'instagram_watchlist');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('instagram', 'owl_central', 'university_calendar', 'athletics', 'eventbrite', 'venue_website', 'ticketing_website', 'rss', 'ical', 'generic_webpage', 'manual_submission', 'other_api');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('verified', 'high_confidence', 'needs_review', 'conflict', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_sources" (
	"event_id" uuid NOT NULL,
	"raw_content_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_url" text,
	CONSTRAINT "event_sources_event_id_raw_content_id_pk" PRIMARY KEY("event_id","raw_content_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"venue" text,
	"address" text,
	"city" text,
	"latitude" double precision,
	"longitude" double precision,
	"price" text,
	"age_requirement" text,
	"category" "event_category" DEFAULT 'other' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"organization" text,
	"source_url" text,
	"source_name" text,
	"source_image" text,
	"original_raw_content_id" uuid NOT NULL,
	"confidence_score" real DEFAULT 0 NOT NULL,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"relevance_score" integer DEFAULT 0 NOT NULL,
	"bucket_scores" jsonb DEFAULT '{"overall":0,"mondayCampus":0,"midweekActivity":0,"thursdayNightlife":0}'::jsonb NOT NULL,
	"verification_status" "verification_status" DEFAULT 'needs_review' NOT NULL,
	"status" "event_status" DEFAULT 'candidate' NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_events" (
	"post_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"slide_number" integer NOT NULL,
	CONSTRAINT "post_events_post_id_event_id_pk" PRIMARY KEY("post_id","event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"post_type" "post_type" NOT NULL,
	"scheduled_date" date NOT NULL,
	"title" text NOT NULL,
	"caption" text,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"scheduler_id" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processing_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid,
	"level" "log_level" DEFAULT 'info' NOT NULL,
	"scope" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text,
	"source_url" text,
	"raw_text" text,
	"media_url" text,
	"local_media_path" text,
	"published_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rendered_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"event_id" uuid,
	"storage_url" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"template" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"timezone" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_radius_miles" integer DEFAULT 50 NOT NULL,
	"weekly_schedule" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instagram_account" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schools_short_name_unique" UNIQUE("short_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"category" "source_category" NOT NULL,
	"url" text,
	"instagram_handle" text,
	"priority" integer DEFAULT 5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"scrape_frequency_minutes" integer DEFAULT 360 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_successful_check_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_raw_content_id_raw_content_id_fk" FOREIGN KEY ("raw_content_id") REFERENCES "public"."raw_content"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_original_raw_content_id_raw_content_id_fk" FOREIGN KEY ("original_raw_content_id") REFERENCES "public"."raw_content"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_events" ADD CONSTRAINT "post_events_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_events" ADD CONSTRAINT "post_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "posts" ADD CONSTRAINT "posts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "processing_logs" ADD CONSTRAINT "processing_logs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_content" ADD CONSTRAINT "raw_content_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_content" ADD CONSTRAINT "raw_content_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rendered_assets" ADD CONSTRAINT "rendered_assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rendered_assets" ADD CONSTRAINT "rendered_assets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sources" ADD CONSTRAINT "sources_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_content_source_external_idx" ON "raw_content" USING btree ("source_id","external_id");