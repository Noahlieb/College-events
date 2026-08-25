ALTER TABLE "asset_candidates" ADD COLUMN "generation_provider" text;--> statement-breakpoint
ALTER TABLE "asset_candidates" ADD COLUMN "generation_model" text;--> statement-breakpoint
ALTER TABLE "asset_candidates" ADD COLUMN "generation_prompt" text;--> statement-breakpoint
ALTER TABLE "asset_candidates" ADD COLUMN "generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "generation_status" text DEFAULT 'not_needed' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "generation_input_hash" text;