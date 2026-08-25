-- Move Owl Central off the CSV boundary and onto the reusable CampusLabs
-- adapter. Nothing about this is FAU-specific except the host it reads out
-- of the existing row: the same statements would migrate any university's
-- Engage install.
--
-- Data-only migration. Written by hand rather than generated because
-- drizzle-kit diffs schema, and there is no schema change here.

-- The CSV-fed Owl Central source becomes a live campuslabs source. Its id
-- is preserved, so every event, raw_content row and event_sources link
-- already attributed to it keeps its provenance.
UPDATE "sources" SET
  "name"          = 'Owl Central',
  "source_type"   = 'university_calendar',
  "adapter_type"  = 'campuslabs',
  "url"           = COALESCE("url", 'https://' || (
                      SELECT lower("short_name") || '.campuslabs.com' FROM "schools" s WHERE s.id = "sources"."school_id"
                    ) || '/engage/events'),
  "config"        = jsonb_build_object(
                      'host', COALESCE(
                        NULLIF(split_part(replace(replace(COALESCE("url", ''), 'https://', ''), 'http://', ''), '/', 1), ''),
                        (SELECT lower("short_name") || '.campuslabs.com' FROM "schools" s WHERE s.id = "sources"."school_id")
                      ),
                      'lookaheadDays', 45,
                      'pageSize', 100
                    ),
  -- 0 meant "never polled, it is fed externally". It is polled now.
  "crawl_interval_minutes"   = 240,
  "scrape_frequency_minutes" = 240,
  "next_run_at"   = now()
WHERE "name" = 'Owl Central (CSV Import)';--> statement-breakpoint

-- Posh keeps its row and its history, but is now crawled through the
-- degraded-capable adapter rather than a local Playwright run feeding CSV.
-- eventUrls starts empty: with nothing configured the adapter yields zero
-- rather than guessing, which is the fix for the trending-rail incident
-- where a location-blind fallback returned out-of-state events.
UPDATE "sources" SET
  "source_type"  = 'ticketing_website',
  "adapter_type" = 'posh',
  "config"       = COALESCE("config", '{}'::jsonb) || jsonb_build_object('eventUrls', '[]'::jsonb)
WHERE "name" = 'Posh.vip Nightlife';--> statement-breakpoint

-- The old iCal row becomes the documented fallback feed rather than a
-- second, competing campuslabs source.
UPDATE "sources" SET
  "name"         = 'Owl Central (iCal feed)',
  "source_type"  = 'ical',
  "adapter_type" = 'ical',
  "url"          = regexp_replace(COALESCE("url", ''), '/events/?$', '/events.ics')
WHERE "source_type" = 'owl_central';
