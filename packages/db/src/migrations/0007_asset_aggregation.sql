ALTER TYPE "public"."asset_classification" ADD VALUE 'venue_photo' BEFORE 'photo';--> statement-breakpoint
ALTER TYPE "public"."asset_classification" ADD VALUE 'generic_social_image' BEFORE 'photo';--> statement-breakpoint
ALTER TABLE "asset_candidates" ADD COLUMN "bytes" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "asset_discovery_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "asset_discovery_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "selected_asset_reason" text;--> statement-breakpoint
-- NOTE: the two ALTER TYPE ... ADD VALUE statements above require
-- PostgreSQL 12 or newer to run inside a transaction. They only add
-- values; no existing row changes classification, so this is additive and
-- safe to re-run against a database that already has them.

-- Events that already have candidates have been through discovery under
-- the old single-image path; mark them complete so the artwork generator
-- does not treat them as "not yet asked" and start generating for events
-- that already have artwork.
UPDATE "events" e
   SET "asset_discovery_status" = 'complete',
       "asset_discovery_completed_at" = now()
 WHERE EXISTS (SELECT 1 FROM "asset_candidates" a WHERE a."event_id" = e."id");--> statement-breakpoint

-- Events with a chosen asset get a reason, so the review UI never shows a
-- selection with no explanation behind it.
UPDATE "events"
   SET "selected_asset_reason" = 'selected before per-source asset aggregation existed'
 WHERE "canonical_asset_id" IS NOT NULL AND "selected_asset_reason" IS NULL;
