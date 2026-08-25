CREATE TYPE "public"."asset_classification" AS ENUM('flyer', 'event_art', 'photo', 'logo', 'generated', 'unknown');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"source_id" uuid,
	"raw_content_id" uuid,
	"source_url" text NOT NULL,
	"storage_url" text,
	"width" integer,
	"height" integer,
	"mime" text,
	"perceptual_hash" text,
	"classification" "asset_classification" DEFAULT 'unknown' NOT NULL,
	"is_official" boolean DEFAULT false NOT NULL,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"origin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "canonical_asset_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_candidates" ADD CONSTRAINT "asset_candidates_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_candidates" ADD CONSTRAINT "asset_candidates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_candidates" ADD CONSTRAINT "asset_candidates_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_candidates" ADD CONSTRAINT "asset_candidates_raw_content_id_raw_content_id_fk" FOREIGN KEY ("raw_content_id") REFERENCES "public"."raw_content"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_candidate_event_url_idx" ON "asset_candidates" USING btree ("event_id","source_url");