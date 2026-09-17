import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import "../env.js";
import { db, pool } from "../client.js";
import { dealRawContent, merchants, merchantSources, processingLogs, schools } from "../schema.js";
import { distanceMiles } from "@college-events/core";
import { UCF_MERCHANTS, UCF_PENDING_DEAL_CONTENT, UCF_SCHOOL } from "./deals-data.js";

async function main() {
  console.log("Seeding UCF (Deals product)...");

  const schoolValues = { ...UCF_SCHOOL, weeklySchedule: [...UCF_SCHOOL.weeklySchedule], commercialCorridors: [...UCF_SCHOOL.commercialCorridors] };
  const [university] = await db
    .insert(schools)
    .values(schoolValues)
    .onConflictDoUpdate({
      target: schools.shortName,
      set: { ...schoolValues, updatedAt: new Date() },
    })
    .returning();
  if (!university) throw new Error("Failed to upsert UCF school row");
  console.log(`  university: ${university.name} (${university.id})`);

  const merchantIdByKey = new Map<string, string>();
  const sourceIdByKey = new Map<string, string>();

  for (const m of UCF_MERCHANTS) {
    const dist = distanceMiles(university.latitude, university.longitude, m.latitude, m.longitude);
    const [row] = await db
      .insert(merchants)
      .values({
        universityId: university.id,
        name: m.name,
        category: m.category,
        subcategory: m.subcategory ?? null,
        streetAddress: m.streetAddress,
        latitude: m.latitude,
        longitude: m.longitude,
        distanceFromCampusMiles: dist,
        estimatedDriveTimeMinutes: m.estimatedDriveTimeMinutes,
        website: m.website ?? null,
        instagramUrl: m.instagramUrl ?? null,
        discoverySource: m.discoverySource,
        studentRelevanceScore: m.studentRelevanceScore,
        monitoringTier: m.monitoringTier,
        active: true,
      })
      .returning();
    if (!row) throw new Error(`Failed to insert merchant ${m.key}`);
    merchantIdByKey.set(m.key, row.id);

    for (const s of m.sources) {
      const [sourceRow] = await db
        .insert(merchantSources)
        .values({
          merchantId: row.id,
          sourceType: s.sourceType,
          sourceUrl: s.sourceUrl,
          monitorFrequencyHours: s.monitorFrequencyHours,
          scrapingMethod: s.scrapingMethod,
          notes: s.notes ?? null,
          active: true,
        })
        .returning();
      if (!sourceRow) throw new Error(`Failed to insert merchant source ${s.key}`);
      sourceIdByKey.set(s.key, sourceRow.id);
    }
  }
  console.log(`  merchants: ${merchantIdByKey.size}`);
  console.log(`  merchant sources: ${sourceIdByKey.size}`);

  let pendingCount = 0;
  for (const item of UCF_PENDING_DEAL_CONTENT) {
    const merchantId = merchantIdByKey.get(item.merchantKey);
    const merchantSourceId = sourceIdByKey.get(item.sourceKey);
    if (!merchantId || !merchantSourceId) {
      throw new Error(`Unknown merchant/source key for pending deal ${item.key}`);
    }
    const [sourceRow] = await db.select().from(merchantSources).where(eq(merchantSources.id, merchantSourceId)).limit(1);
    await db.insert(dealRawContent).values({
      merchantId,
      merchantSourceId,
      universityId: university.id,
      sourceUrl: sourceRow?.sourceUrl ?? null,
      rawText: item.rawText,
      contentHash: createHash("sha256").update(item.rawText).digest("hex"),
      processingStatus: "pending",
    });
    pendingCount++;
  }
  console.log(`  pending deal_raw_content (for deals:process demo): ${pendingCount}`);

  await db.insert(processingLogs).values({
    schoolId: university.id,
    level: "info",
    scope: "deals.seed",
    message: `Seeded UCF with ${merchantIdByKey.size} merchants, ${sourceIdByKey.size} merchant sources, ${pendingCount} pending deal_raw_content rows.`,
    metadata: {},
  });

  console.log("Deals seed complete.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
