CREATE TABLE IF NOT EXISTS "discovery_probe_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"queries_run" integer NOT NULL,
	"results_seen" integer NOT NULL,
	"matched" integer NOT NULL,
	"recorded_as_misses" integer NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovery_probe_runs" ADD CONSTRAINT "discovery_probe_runs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
