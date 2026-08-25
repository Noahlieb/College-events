CREATE TABLE IF NOT EXISTS "source_discovery_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"detected_adapter" "adapter_type",
	"detected_entity_type" "entity_type",
	"confidence" real DEFAULT 0 NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discovery_method" text NOT NULL,
	"coverage_category" text,
	"status" "discovery_candidate_status" DEFAULT 'pending' NOT NULL,
	"promoted_source_id" uuid,
	"rejected_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_discovery_candidates" ADD CONSTRAINT "source_discovery_candidates_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_discovery_candidates" ADD CONSTRAINT "source_discovery_candidates_promoted_source_id_sources_id_fk" FOREIGN KEY ("promoted_source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_candidate_school_url_idx" ON "source_discovery_candidates" USING btree ("school_id","url");