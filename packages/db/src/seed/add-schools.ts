import "../env.js";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../client.js";
import { schools, sources } from "../schema.js";
import { NEW_SCHOOLS } from "./new-schools.js";

/**
 * Inserts real `schools` + `sources` rows for schools beyond the FAU demo
 * seed (see README's "Adding a new school"). Unlike `seed/index.ts`, this
 * writes no events/raw_content -- there's no real campus/athletics data for
 * these schools yet, only the posh.vip nightlife source the scraper (driven
 * by scrapers/schools.json) actually points at. Idempotent: re-running
 * upserts the school row by short_name and skips a source that already
 * exists by name, so it's safe to run again after adding real sources
 * through the dashboard.
 */
async function main() {
  for (const { school: schoolData, sources: sourceDefs } of NEW_SCHOOLS) {
    const schoolValues = { ...schoolData, weeklySchedule: [...schoolData.weeklySchedule] };
    const [school] = await db
      .insert(schools)
      .values(schoolValues)
      .onConflictDoUpdate({
        target: schools.shortName,
        set: { ...schoolValues, updatedAt: new Date() },
      })
      .returning();
    if (!school) throw new Error(`Failed to upsert school row for ${schoolData.shortName}`);
    console.log(`school: ${school.name} (${school.id})`);

    for (const s of sourceDefs) {
      const [existing] = await db
        .select()
        .from(sources)
        .where(and(eq(sources.schoolId, school.id), eq(sources.name, s.name)))
        .limit(1);
      if (existing) {
        console.log(`  source already exists: ${s.name}`);
        continue;
      }
      const [row] = await db
        .insert(sources)
        .values({
          schoolId: school.id,
          name: s.name,
          sourceType: s.sourceType,
          category: s.category,
          url: s.url ?? null,
          instagramHandle: s.instagramHandle ?? null,
          priority: s.priority,
          active: s.active ?? true,
          scrapeFrequencyMinutes: s.scrapeFrequencyMinutes ?? 360,
          metadata: s.forceCategory ? { forceCategory: s.forceCategory } : {},
        })
        .returning();
      if (!row) throw new Error(`Failed to insert source ${s.key} for ${schoolData.shortName}`);
      console.log(`  source: ${row.name}`);
    }
  }
  console.log("Done.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
