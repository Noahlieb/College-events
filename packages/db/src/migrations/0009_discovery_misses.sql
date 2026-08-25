CREATE TABLE IF NOT EXISTS "discovery_misses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"discovered_url" text NOT NULL,
	"event_title" text NOT NULL,
	"event_date_guess" timestamp with time zone,
	"referring_provider" text NOT NULL,
	"matched_entity_id" uuid,
	"matched_event_id" uuid,
	"suspected_domain" text NOT NULL,
	"had_existing_candidate" boolean DEFAULT false NOT NULL,
	"created_candidate_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery_misses" ADD CONSTRAINT "discovery_misses_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery_misses" ADD CONSTRAINT "discovery_misses_matched_entity_id_entities_id_fk" FOREIGN KEY ("matched_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery_misses" ADD CONSTRAINT "discovery_misses_matched_event_id_events_id_fk" FOREIGN KEY ("matched_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery_misses" ADD CONSTRAINT "discovery_misses_created_candidate_id_source_discovery_candidates_id_fk" FOREIGN KEY ("created_candidate_id") REFERENCES "public"."source_discovery_candidates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_miss_school_url_idx" ON "discovery_misses" USING btree ("school_id","discovered_url");