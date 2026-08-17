import { and, eq, gte, lte, ne } from "drizzle-orm";
import { db, events, eventSources, rawContent, schools, sources } from "@college-events/db";
import { areDuplicates, computeVerificationStatus, daysUntil, parseEventDate, scoreEvent, type EventCategory } from "@college-events/core";
import { buildManualRawContent, type ManualEventInput } from "@college-events/ingestion";
import { estimateDistanceMiles } from "../lib/geo-heuristic.js";
import { log } from "../lib/log.js";

/**
 * Manual event entry (spec §33). Reuses the exact same raw_content shape,
 * scoring, and duplicate-detection logic as the AI pipeline — the only
 * thing skipped is the AI *extraction* call, since a human already
 * supplied structured fields. Everything downstream (dedup, scoring,
 * rendering, carousel selection) is identical either way.
 */
export async function submitManualEvent(
  schoolId: string,
  manualSourceId: string,
  input: ManualEventInput,
): Promise<{ eventId: string; merged: boolean }> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school ${schoolId}`);
  const [manualSource] = await db.select().from(sources).where(eq(sources.id, manualSourceId)).limit(1);
  if (!manualSource) throw new Error(`Unknown manual-submission source ${manualSourceId}`);

  const discovered = buildManualRawContent(input);
  const parsedDates = parseEventDate({
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime ?? null,
    timezone: school.timezone,
  });

  const [raw] = await db
    .insert(rawContent)
    .values({
      schoolId,
      sourceId: manualSourceId,
      externalId: discovered.externalId,
      sourceUrl: discovered.sourceUrl,
      rawText: discovered.rawText,
      mediaUrl: discovered.mediaUrl,
      publishedAt: new Date(),
      processingStatus: "processed",
      rawMetadata: { ...discovered.rawMetadata, observedStartAt: parsedDates.startAt, observedEndAt: parsedDates.endAt },
    })
    .returning();
  if (!raw) throw new Error("Failed to insert manual raw_content");

  const category: EventCategory = input.category;
  const distanceMiles = estimateDistanceMiles(input.venue, school.city); // best-effort; venue text rarely names a city directly
  const daysOut = daysUntil(parsedDates.startAt, school.timezone);
  const bucketScores = scoreEvent({
    category,
    distanceMiles,
    priceText: input.price,
    isCampusAffiliated: true, // manual entries are submitted by our own team/VA reviewing a real source
    daysUntilStart: daysOut,
  });

  const windowStart = new Date(new Date(parsedDates.startAt).getTime() - 30 * 3600_000);
  const windowEnd = new Date(new Date(parsedDates.startAt).getTime() + 30 * 3600_000);
  const candidates = await db
    .select()
    .from(events)
    .where(and(eq(events.schoolId, schoolId), ne(events.status, "rejected"), gte(events.startAt, windowStart), lte(events.startAt, windowEnd)));

  const duplicateMatch = candidates
    .map((c) => ({
      event: c,
      result: areDuplicates(
        { id: c.id, name: c.name, startAt: c.startAt.toISOString(), venue: c.venue, organization: c.organization },
        { id: raw.id, name: input.name, startAt: parsedDates.startAt, venue: input.venue, organization: null },
      ),
    }))
    .filter((m) => m.result.isDuplicate)
    .sort((a, b) => b.result.score - a.result.score)[0];

  if (duplicateMatch) {
    await db.insert(eventSources).values({ eventId: duplicateMatch.event.id, rawContentId: raw.id, sourceId: manualSourceId, sourceUrl: input.sourceUrl });
    await log(schoolId, "info", "manual_entry", `Manual submission merged into existing event ${duplicateMatch.event.id}`, { rawContentId: raw.id });
    return { eventId: duplicateMatch.event.id, merged: true };
  }

  const { status: verificationStatus } = computeVerificationStatus([
    { sourceId: manualSourceId, sourcePriority: manualSource.priority, startAt: parsedDates.startAt },
  ]);

  const [event] = await db
    .insert(events)
    .values({
      schoolId,
      name: input.name,
      description: input.description,
      startAt: new Date(parsedDates.startAt),
      endAt: parsedDates.endAt ? new Date(parsedDates.endAt) : null,
      venue: input.venue,
      price: input.price,
      category,
      tags: [category],
      organization: null,
      sourceUrl: input.sourceUrl,
      sourceName: `Manual entry (${input.submittedBy})`,
      sourceImage: input.flyerUrl,
      originalRawContentId: raw.id,
      confidenceScore: 1, // human-verified
      fieldConfidence: { eventName: 1, date: 1, startTime: 1, endTime: input.endTime ? 1 : 0, venue: 1, price: input.price ? 1 : 0, category: 1 },
      relevanceScore: bucketScores.overall,
      bucketScores,
      verificationStatus,
      status: verificationStatus === "conflict" ? "candidate" : "active",
      flags: [],
    })
    .returning();
  if (!event) throw new Error("Failed to insert manual event");

  await db.insert(eventSources).values({ eventId: event.id, rawContentId: raw.id, sourceId: manualSourceId, sourceUrl: input.sourceUrl });
  await log(schoolId, "info", "manual_entry", `Manual submission created event ${event.id}`, { rawContentId: raw.id });

  return { eventId: event.id, merged: false };
}
