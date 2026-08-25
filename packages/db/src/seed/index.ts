import { eq } from "drizzle-orm";
import "../env.js";
import { db, pool } from "../client.js";
import {
  entities,
  entitySources,
  events,
  eventSources,
  processingLogs,
  rawContent,
  schools,
  sources,
} from "../schema.js";
import {
  categorizeEvent,
  computeVerificationStatus,
  distanceMiles,
  normalizeEntityName,
  scoreEvent,
} from "@college-events/core";
import {
  FAU_ENTITIES,
  FAU_EVENTS,
  FAU_PENDING_RAW_CONTENT,
  FAU_SCHOOL,
  FAU_SOURCES,
  SECONDARY_SOURCE_KEYS,
  dt,
} from "./data.js";

const FAU_CAMPUS = { lat: FAU_SCHOOL.latitude, lng: FAU_SCHOOL.longitude };

async function main() {
  console.log("Seeding FAU...");

  const schoolValues = { ...FAU_SCHOOL, weeklySchedule: [...FAU_SCHOOL.weeklySchedule] };
  const [school] = await db
    .insert(schools)
    .values(schoolValues)
    .onConflictDoUpdate({
      target: schools.shortName,
      set: { ...schoolValues, updatedAt: new Date() },
    })
    .returning();
  if (!school) throw new Error("Failed to upsert FAU school row");
  console.log(`  school: ${school.name} (${school.id})`);

  const sourceIdByKey = new Map<string, string>();
  for (const s of FAU_SOURCES) {
    const [row] = await db
      .insert(sources)
      .values({
        schoolId: school.id,
        name: s.name,
        sourceType: s.sourceType,
        adapterType: s.adapterType,
        category: s.category,
        url: s.url ?? null,
        discoveryUrl: s.discoveryUrl ?? null,
        instagramHandle: s.instagramHandle ?? null,
        // The three successors to the old single `priority`. Seeded from it
        // unless a source states otherwise, so behaviour is unchanged until
        // someone deliberately pulls them apart.
        priority: s.priority,
        trustScore: s.trustScore ?? s.priority,
        crawlPriority: s.crawlPriority ?? s.priority,
        relevanceBias: s.relevanceBias ?? 0,
        categoryBias: s.forceCategory ?? null,
        active: s.active ?? true,
        // An inactive source is parked, not broken — coverage metrics must
        // not read it as a failure.
        healthStatus: (s.active ?? true) ? "healthy" : "disabled",
        crawlIntervalMinutes: s.scrapeFrequencyMinutes ?? 360,
        scrapeFrequencyMinutes: s.scrapeFrequencyMinutes ?? 360,
        config: s.config ?? {},
        metadata: s.forceCategory ? { forceCategory: s.forceCategory } : {},
      })
      .returning();
    if (!row) throw new Error(`Failed to insert source ${s.key}`);
    sourceIdByKey.set(s.key, row.id);
  }
  console.log(`  sources: ${sourceIdByKey.size}`);

  // ── entity graph ────────────────────────────────────────────────
  // Link each source to the real-world producer behind it, so several
  // sources reporting one venue's calendar are recognised as such rather
  // than looking like unrelated feeds.
  let entityLinks = 0;
  for (const e of FAU_ENTITIES) {
    const [entity] = await db
      .insert(entities)
      .values({
        schoolId: school.id,
        entityType: e.entityType,
        name: e.name,
        normalizedName: normalizeEntityName(e.name),
        website: e.website ?? null,
        engagementProfileUrl: e.engagementProfileUrl ?? null,
        instagramHandle: e.instagramHandle ?? null,
        eventPageUrl: e.eventPageUrl ?? null,
        ticketingUrl: e.ticketingUrl ?? null,
        city: e.city ?? null,
      })
      .returning();
    if (!entity) throw new Error(`Failed to insert entity ${e.key}`);

    for (const sourceKey of e.sourceKeys ?? []) {
      const sourceId = sourceIdByKey.get(sourceKey);
      if (!sourceId) throw new Error(`Entity ${e.key} references unknown source ${sourceKey}`);
      const role = SECONDARY_SOURCE_KEYS.has(sourceKey) ? "secondary" : "primary";
      await db.insert(entitySources).values({ entityId: entity.id, sourceId, role });
      // The denormalized pointer on the source is what the crawler reads;
      // entity_sources is the full many-to-many record.
      await db
        .update(sources)
        .set({ entityType: e.entityType, entityId: entity.id })
        .where(eq(sources.id, sourceId));
      entityLinks++;
    }
  }
  console.log(`  entities: ${FAU_ENTITIES.length} (${entityLinks} source links)`);

  let eventCount = 0;
  const now = new Date();

  for (const seed of FAU_EVENTS) {
    const primaryDates = dt(seed.date, seed.startTime, seed.endTime);
    const dist = distanceMiles(FAU_CAMPUS.lat, FAU_CAMPUS.lng, seed.latitude, seed.longitude);
    const daysUntilStart = Math.round(
      (new Date(primaryDates.startAt).getTime() - now.getTime()) / 86_400_000,
    );

    const { tags } = categorizeEvent({
      name: seed.name,
      description: seed.description,
      organization: seed.organization,
    });

    const bucketScores = scoreEvent({
      category: seed.category,
      distanceMiles: dist,
      priceText: seed.price,
      isCampusAffiliated: seed.isCampusAffiliated,
      daysUntilStart,
      isRecurring: seed.isRecurring ?? false,
    });

    // Create one raw_content row per corroborating source.
    const rawIds: {
      rawContentId: string;
      sourceId: string;
      sourceKey: string;
      priority: number;
      startAt: string;
    }[] = [];
    for (let i = 0; i < seed.sourceKeys.length; i++) {
      const sourceKey = seed.sourceKeys[i]!;
      const sourceId = sourceIdByKey.get(sourceKey);
      const sourceDef = FAU_SOURCES.find((s) => s.key === sourceKey);
      if (!sourceId || !sourceDef) throw new Error(`Unknown source key ${sourceKey} for event ${seed.key}`);

      const useConflictTime = i === 1 && seed.conflictingStartTime;
      const observedDates = useConflictTime
        ? dt(seed.date, seed.conflictingStartTime!, seed.endTime)
        : primaryDates;

      const [raw] = await db
        .insert(rawContent)
        .values({
          schoolId: school.id,
          sourceId,
          externalId: `seed-${seed.key}-${sourceKey}`,
          sourceUrl: seed.link,
          rawText: seed.description,
          mediaUrl: seed.sourceImage,
          publishedAt: new Date(now.getTime() - (i + 1) * 3_600_000),
          processingStatus: "processed",
          rawMetadata: { seedEventKey: seed.key, observedStartAt: observedDates.startAt },
        })
        .returning();
      if (!raw) throw new Error("Failed to insert raw_content");
      rawIds.push({
        rawContentId: raw.id,
        sourceId,
        sourceKey,
        priority: sourceDef.priority,
        startAt: observedDates.startAt,
      });
    }

    const primaryRaw = rawIds[0]!;
    const primarySource = FAU_SOURCES.find((s) => s.key === primaryRaw.sourceKey)!;

    // Verification status is derived from real source-observation logic (spec §16),
    // not hardcoded — this is the same function the live AI pipeline uses.
    const { status: verificationStatus } = computeVerificationStatus(
      rawIds.map((r) => ({ sourceId: r.sourceId, sourcePriority: r.priority, startAt: r.startAt })),
    );

    const status =
      seed.statusOverride ?? (verificationStatus === "conflict" ? "candidate" : "active");

    const [event] = await db
      .insert(events)
      .values({
        schoolId: school.id,
        name: seed.name,
        description: seed.description,
        startAt: new Date(primaryDates.startAt),
        endAt: primaryDates.endAt ? new Date(primaryDates.endAt) : null,
        venue: seed.venue,
        address: seed.address ?? null,
        city: seed.city,
        latitude: seed.latitude,
        longitude: seed.longitude,
        price: seed.price,
        ageRequirement: seed.ageRequirement ?? null,
        category: seed.category,
        tags,
        organization: seed.organization,
        sourceUrl: seed.link,
        sourceName: primarySource.name,
        sourceImage: seed.sourceImage,
        originalRawContentId: primaryRaw.rawContentId,
        confidenceScore: seed.conflictingStartTime ? 0.55 : 0.92,
        fieldConfidence: {
          eventName: 0.97,
          date: 0.95,
          startTime: seed.conflictingStartTime ? 0.5 : 0.93,
          endTime: seed.endTime ? 0.85 : 0,
          venue: 0.9,
          price: seed.price ? 0.88 : 0,
          category: 0.9,
        },
        relevanceScore: bucketScores.overall,
        bucketScores,
        verificationStatus,
        status,
        flags: seed.flags ?? [],
      })
      .returning();
    if (!event) throw new Error(`Failed to insert event ${seed.key}`);

    for (const r of rawIds) {
      await db.insert(eventSources).values({
        eventId: event.id,
        rawContentId: r.rawContentId,
        sourceId: r.sourceId,
        sourceUrl: seed.link,
      });
    }

    eventCount++;
  }
  console.log(`  events: ${eventCount}`);

  let pendingCount = 0;
  for (const item of FAU_PENDING_RAW_CONTENT) {
    const sourceId = sourceIdByKey.get(item.sourceKey);
    if (!sourceId) throw new Error(`Unknown source key ${item.sourceKey}`);
    await db.insert(rawContent).values({
      schoolId: school.id,
      sourceId,
      externalId: item.externalId,
      sourceUrl: item.sourceUrl,
      rawText: item.rawText,
      mediaUrl: item.mediaUrl,
      publishedAt: new Date(item.publishedAt),
      processingStatus: "pending",
      rawMetadata: { seedKey: item.key },
    });
    pendingCount++;
  }
  console.log(`  pending raw_content (for AI pipeline demo): ${pendingCount}`);

  await db.insert(processingLogs).values({
    schoolId: school.id,
    level: "info",
    scope: "seed",
    message: `Seeded FAU with ${sourceIdByKey.size} sources, ${eventCount} events, ${pendingCount} pending raw_content rows.`,
    metadata: {},
  });

  console.log("Seed complete.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
