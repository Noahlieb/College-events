CREATE TABLE IF NOT EXISTS "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"website" text,
	"engagement_profile_url" text,
	"instagram_handle" text,
	"linktree_url" text,
	"event_page_url" text,
	"ticketing_url" text,
	"address" text,
	"city" text,
	"latitude" double precision,
	"longitude" double precision,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_sources" (
	"entity_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_sources_entity_id_source_id_pk" PRIMARY KEY("entity_id","source_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_sources" ADD CONSTRAINT "entity_sources_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_sources" ADD CONSTRAINT "entity_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entities_school_type_name_idx" ON "entities" USING btree ("school_id","entity_type","normalized_name");--> statement-breakpoint
-- ── backfill: give every existing source the producer it reports on ────
-- Derived entirely from each source's own name, URL and type, so this runs
-- unchanged for any university's sources. Names are normalized the same way
-- the application does (lowercase, punctuation stripped) so a later
-- discovery of the same venue updates this row rather than adding a rival.

INSERT INTO "entities" (
  "school_id", "entity_type", "name", "normalized_name",
  "website", "instagram_handle", "city", "active"
)
SELECT
  s."school_id",
  CASE
    WHEN s."source_type" = 'athletics'  THEN 'department'
    WHEN s."source_type" = 'instagram'  THEN 'organization'
    WHEN s."category"    = 'nearby'     THEN 'venue'
    ELSE 'organization'
  END::"public"."entity_type",
  s."name",
  -- Mirror of normalizeEntityName(): lowercase, strip punctuation, collapse
  -- whitespace. The application's noise-word stripping is deliberately not
  -- reproduced here — a slightly coarser key can only cause a *miss*, and a
  -- miss is recoverable while a bad merge is not.
  trim(regexp_replace(lower(regexp_replace(s."name", '[^A-Za-z0-9 ]', ' ', 'g')), '\s+', ' ', 'g')),
  s."url",
  s."instagram_handle",
  NULL,
  s."active"
FROM "sources" s
WHERE s."source_type" <> 'manual_submission'
ON CONFLICT ("school_id", "entity_type", "normalized_name") DO NOTHING;--> statement-breakpoint

-- Link each source to the entity that carries its name.
INSERT INTO "entity_sources" ("entity_id", "source_id", "role")
SELECT
  e."id",
  s."id",
  -- A source that covers many producers without being any of them (a city
  -- or tourism calendar) is secondary: it must never outrank a venue's own
  -- page when flyers are compared.
  CASE WHEN s."category" = 'nearby' AND s."source_type" = 'generic_webpage' THEN 'secondary' ELSE 'primary' END
FROM "sources" s
JOIN "entities" e
  ON e."school_id" = s."school_id"
 AND e."normalized_name" = trim(regexp_replace(lower(regexp_replace(s."name", '[^A-Za-z0-9 ]', ' ', 'g')), '\s+', ' ', 'g'))
ON CONFLICT ("entity_id", "source_id") DO NOTHING;--> statement-breakpoint

-- Denormalized pointer the crawler reads, kept consistent with the join.
UPDATE "sources" s
   SET "entity_id" = es."entity_id",
       "entity_type" = e."entity_type"
  FROM "entity_sources" es
  JOIN "entities" e ON e."id" = es."entity_id"
 WHERE es."source_id" = s."id"
   AND es."role" = 'primary'
   AND s."entity_id" IS NULL;
