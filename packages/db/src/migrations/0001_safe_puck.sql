CREATE TYPE "public"."content_eligibility" AS ENUM('feed_worthy', 'story_worthy', 'evergreen_library', 'reject');--> statement-breakpoint
CREATE TYPE "public"."content_post_slot" AS ENUM('monday_top5', 'tuesday_deal', 'wednesday_local', 'friday_weekend', 'sunday_roundup', 'story');--> statement-breakpoint
CREATE TYPE "public"."deal_category" AS ENUM('food_restaurant', 'coffee_cafe', 'dessert', 'fast_casual', 'pizza_wings', 'bar_nightlife', 'fitness', 'beauty_barber_nails', 'entertainment', 'housing', 'retail_services', 'other');--> statement-breakpoint
CREATE TYPE "public"."deal_content_post_status" AS ENUM('draft', 'needs_review', 'ready_for_approval', 'approved', 'scheduled', 'published', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."deal_source_type" AS ENUM('official_website', 'promotions_page', 'menu_page', 'online_ordering_page', 'rewards_page', 'newsletter', 'instagram', 'google_business', 'university_program', 'manual');--> statement-breakpoint
CREATE TYPE "public"."deal_verification_status" AS ENUM('verified', 'high_confidence', 'needs_review', 'stale', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."dedup_status" AS ENUM('new', 'updated', 'existing_recurring', 'duplicate', 'expired');--> statement-breakpoint
CREATE TYPE "public"."freshness_status" AS ENUM('new', 'active', 'recurring', 'updated', 'expiring_soon', 'expired', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."merchant_category" AS ENUM('restaurant', 'fast_casual', 'pizza', 'wings', 'sushi', 'coffee_boba', 'dessert', 'bar_nightlife', 'gym_fitness', 'yoga_pilates', 'pickleball', 'barber', 'hair_salon', 'nail_salon', 'tanning', 'bowling_arcade', 'movie_theater', 'escape_room', 'entertainment_other', 'student_housing', 'car_wash_auto', 'retail', 'tutoring_test_prep', 'moving_storage', 'other');--> statement-breakpoint
CREATE TYPE "public"."merchant_tier" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."scraping_method" AS ENUM('static_fetch', 'playwright', 'manual');--> statement-breakpoint
CREATE TYPE "public"."submission_source_type" AS ENUM('scraped', 'manual', 'student_submission', 'business_submission', 'sponsored', 'exclusive');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'approved', 'rejected', 'converted_to_deal');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_content_post_deals" (
	"post_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "deal_content_post_deals_post_id_deal_id_pk" PRIMARY KEY("post_id","deal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_content_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"slot" "content_post_slot" NOT NULL,
	"scheduled_date" date NOT NULL,
	"title" text NOT NULL,
	"caption" text,
	"status" "deal_content_post_status" DEFAULT 'draft' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_performance_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"content_post_id" uuid,
	"platform" text DEFAULT 'instagram' NOT NULL,
	"reach" integer,
	"views" integer,
	"shares" integer,
	"saves" integer,
	"likes" integer,
	"comments" integer,
	"profile_visits" integer,
	"follows_generated" integer,
	"link_clicks" integer,
	"redemptions" integer,
	"revenue" real,
	"sponsored_revenue" real,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"merchant_id" uuid,
	"submission_type" "submission_source_type" NOT NULL,
	"submitted_by" text,
	"contact_info" text,
	"raw_text" text NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"deal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_universities" (
	"deal_id" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"distance_miles" real,
	"nearest_location_address" text,
	"eligible" boolean DEFAULT true NOT NULL,
	CONSTRAINT "deal_universities_deal_id_university_id_pk" PRIMARY KEY("deal_id","university_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_verification_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verification_status" "deal_verification_status" NOT NULL,
	"verification_source" text,
	"verified_by" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"title" text NOT NULL,
	"raw_offer_text" text,
	"clean_offer_description" text NOT NULL,
	"deal_category" "deal_category" NOT NULL,
	"normal_price" text,
	"deal_price" text,
	"discount_percent" real,
	"discount_dollars" real,
	"is_bogo" boolean DEFAULT false NOT NULL,
	"is_free_item" boolean DEFAULT false NOT NULL,
	"student_id_required" boolean DEFAULT false NOT NULL,
	"promo_code" text,
	"valid_days_of_week" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" date,
	"expiration_date" date,
	"start_time" text,
	"end_time" text,
	"recurring" boolean DEFAULT false NOT NULL,
	"recurrence_pattern" text,
	"location_restrictions" text,
	"minimum_purchase" text,
	"eligibility" text,
	"source_url" text,
	"source_type" "deal_source_type" NOT NULL,
	"date_discovered" timestamp with time zone DEFAULT now() NOT NULL,
	"date_last_verified" timestamp with time zone,
	"confidence_score" real DEFAULT 0 NOT NULL,
	"verification_status" "deal_verification_status" DEFAULT 'needs_review' NOT NULL,
	"freshness_status" "freshness_status" DEFAULT 'unknown' NOT NULL,
	"quality_score" integer DEFAULT 0 NOT NULL,
	"quality_breakdown" jsonb DEFAULT '{"studentUsefulness":0,"savingsValue":0,"proximity":0,"freshnessUrgency":0,"shareability":0,"merchantRelevance":0}'::jsonb NOT NULL,
	"content_eligibility" "content_eligibility" DEFAULT 'reject' NOT NULL,
	"fingerprint" text NOT NULL,
	"dedup_status" "dedup_status" DEFAULT 'new' NOT NULL,
	"submission_source" "submission_source_type" DEFAULT 'scraped' NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"last_feed_posted_date" date,
	"last_story_posted_date" date,
	"last_content_format" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"source_type" "deal_source_type" NOT NULL,
	"source_url" text NOT NULL,
	"monitor_frequency_hours" integer DEFAULT 24 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"last_successful_check_at" timestamp with time zone,
	"content_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"scraping_method" "scraping_method" DEFAULT 'static_fetch' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "merchant_category" NOT NULL,
	"subcategory" text,
	"street_address" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"distance_from_campus_miles" real NOT NULL,
	"estimated_drive_time_minutes" integer,
	"website" text,
	"instagram_url" text,
	"online_ordering_url" text,
	"specials_url" text,
	"menu_url" text,
	"rewards_url" text,
	"newsletter_url" text,
	"discovery_source" text NOT NULL,
	"student_relevance_score" integer DEFAULT 50 NOT NULL,
	"monitoring_tier" "merchant_tier" DEFAULT 'C' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"date_added" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "student_population" integer;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "primary_radius_miles" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "secondary_radius_miles" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "commercial_corridors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "deals_instagram_account" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_content_post_deals" ADD CONSTRAINT "deal_content_post_deals_post_id_deal_content_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."deal_content_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_content_post_deals" ADD CONSTRAINT "deal_content_post_deals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_content_posts" ADD CONSTRAINT "deal_content_posts_university_id_schools_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_performance_metrics" ADD CONSTRAINT "deal_performance_metrics_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_performance_metrics" ADD CONSTRAINT "deal_performance_metrics_content_post_id_deal_content_posts_id_fk" FOREIGN KEY ("content_post_id") REFERENCES "public"."deal_content_posts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_submissions" ADD CONSTRAINT "deal_submissions_university_id_schools_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_submissions" ADD CONSTRAINT "deal_submissions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_submissions" ADD CONSTRAINT "deal_submissions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_universities" ADD CONSTRAINT "deal_universities_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_universities" ADD CONSTRAINT "deal_universities_university_id_schools_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_verification_records" ADD CONSTRAINT "deal_verification_records_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_university_id_schools_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_sources" ADD CONSTRAINT "merchant_sources_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchants" ADD CONSTRAINT "merchants_university_id_schools_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deals_merchant_fingerprint_idx" ON "deals" USING btree ("merchant_id","fingerprint");