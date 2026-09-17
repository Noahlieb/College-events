CREATE TABLE IF NOT EXISTS "deal_raw_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"merchant_source_id" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"source_url" text,
	"raw_text" text,
	"content_hash" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_raw_content" ADD CONSTRAINT "deal_raw_content_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_raw_content" ADD CONSTRAINT "deal_raw_content_merchant_source_id_merchant_sources_id_fk" FOREIGN KEY ("merchant_source_id") REFERENCES "public"."merchant_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_raw_content" ADD CONSTRAINT "deal_raw_content_university_id_schools_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
