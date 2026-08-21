import { and, eq, gte, lte, ne } from "drizzle-orm";
import {
  db,
  events,
  eventSources,
  rawContent,
  schools,
  sources,
} from "@college-events/db";
import {
  EVENT_CATEGORIES,
  EventDateParseError,
  areDuplicates,
  categorizeEvent,
  computeVerificationStatus,
  daysUntil,
  parseEventDate,
  scoreEvent,
  type EventCategory,
  AWAY_GAME_FLAG,
  isAwayIndicator,
} from "@college-events/core";
import { createAIProvider, type AIProvider } from "@college-events/ai";
import { estimateDistanceMiles, isCampusAffiliated } from "../lib/geo-heuristic.js";
import { log } from "../lib/log.js";

export interface ProcessSummary {
  inspected: number;
  rejectedNotAnEvent: number;
  rejectedDateParseError: number;
  merged: number;
  created: number;
  errored: number;
}

const DEDUP_WINDOW_HOURS = 30;

/**
 * Runs the AI extraction → normalization → dedup → scoring pipeline (spec
 * §11-§16) over every `pending` raw_content row for a school. This is the
 * heart of the system: it's what turns a scraped caption or ICS entry into
 * a scored, categorized, verification-tracked event.
 *
 * Every item is processed independently and wrapped in its own try/catch —
 * one bad AI response or malformed date must never abort the whole batch
 * (spec §30). Failures are recorded on the raw_content row itself and in
 * processing_logs so they're visible on the dashboard's source health view.
 */
export async function processSchoolRawContent(
  schoolId: string,
  aiProvider: AIProvider = createAIProvider(),
): Promise<ProcessSummary> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school ${schoolId}`);

  const pending = await db
    .select({ raw: rawContent, source: sources })
    .from(rawContent)
    .innerJoin(sources, eq(rawContent.sourceId, sources.id))
    .where(and(eq(rawContent.schoolId, schoolId), eq(rawContent.processingStatus, "pending")));

  const summary: ProcessSummary = {
    inspected: 0,
    rejectedNotAnEvent: 0,
    rejectedDateParseError: 0,
    merged: 0,
    created: 0,
    errored: 0,
  };

  for (const { raw, source } of pending) {
    summary.inspected++;
    try {
      const extracted = await aiProvider.analyzeEvent({
        schoolContext: {
          name: school.name,
          shortName: school.shortName,
          city: school.city,
          state: school.state,
          timezone: school.timezone,
        },
        sourceName: source.name,
        sourceType: source.sourceType,
        sourceUrl: raw.sourceUrl,
        caption: raw.rawText,
        publishedAt: raw.publishedAt?.toISOString() ?? null,
        currentDate: new Date().toISOString().slice(0, 10),
      });

      if (!extracted.is_event) {
        await db
          .update(rawContent)
          .set({ processingStatus: "rejected", rawMetadata: { ...raw.rawMetadata, extracted } })
          .where(eq(rawContent.id, raw.id));
        summary.rejectedNotAnEvent++;
        continue;
      }

      let parsedDates;
      try {
        parsedDates = parseEventDate({
          date: extracted.date,
          startTime: extracted.start_time,
          endTime: extracted.end_time,
          timezone: school.timezone,
        });
      } catch (err) {
        if (err instanceof EventDateParseError) {
          await db
            .update(rawContent)
            .set({
              processingStatus: "error",
              rawMetadata: { ...raw.rawMetadata, extracted, error: err.message },
            })
            .where(eq(rawContent.id, raw.id));
          await log(schoolId, "warn", "ai.extract_event", `Date parse failed for raw_content ${raw.id}: ${err.message}`, {
            rawContentId: raw.id,
          });
          summary.rejectedDateParseError++;
          continue;
        }
        throw err;
      }

      const category = resolveCategory(source, extracted);

      const distanceMiles = estimateDistanceMiles(extracted.city, school.city);
      const affiliated = isCampusAffiliated(extracted.organization, school.name, school.shortName, source.category);
      const startDaysOut = daysUntil(parsedDates.startAt, school.timezone);

      const bucketScores = scoreEvent({
        category,
        distanceMiles,
        priceText: extracted.price,
        isCampusAffiliated: affiliated,
        daysUntilStart: startDaysOut,
      });

      // Persist the extraction on raw_content regardless of outcome below —
      // this is what lets verification/conflict detection reconstruct every
      // source's independent observation later (spec §16).
      const enrichedMetadata = {
        ...raw.rawMetadata,
        extracted,
        observedStartAt: parsedDates.startAt,
        observedEndAt: parsedDates.endAt,
      };

      const windowStart = new Date(new Date(parsedDates.startAt).getTime() - DEDUP_WINDOW_HOURS * 3600_000);
      const windowEnd = new Date(new Date(parsedDates.startAt).getTime() + DEDUP_WINDOW_HOURS * 3600_000);
      const candidates = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.schoolId, schoolId),
            ne(events.status, "rejected"),
            gte(events.startAt, windowStart),
            lte(events.startAt, windowEnd),
          ),
        );

      const duplicateMatch = candidates
        .map((c) => ({
          event: c,
          result: areDuplicates(
            { id: c.id, name: c.name, startAt: c.startAt.toISOString(), venue: c.venue, organization: c.organization },
            {
              id: raw.id,
              name: extracted.event_name ?? "",
              startAt: parsedDates.startAt,
              venue: extracted.venue,
              organization: extracted.organization,
            },
          ),
        }))
        .filter((m) => m.result.isDuplicate)
        .sort((a, b) => b.result.score - a.result.score)[0];

      if (duplicateMatch) {
        await mergeIntoExistingEvent({
          schoolId,
          school,
          existingEventId: duplicateMatch.event.id,
          rawContentId: raw.id,
          source,
          extracted,
          parsedStartAt: parsedDates.startAt,
        });
        await db
          .update(rawContent)
          .set({ processingStatus: "processed", rawMetadata: enrichedMetadata })
          .where(eq(rawContent.id, raw.id));
        summary.merged++;
        continue;
      }

      const { status: verificationStatus } = computeVerificationStatus([
        { sourceId: source.id, sourcePriority: source.priority, startAt: parsedDates.startAt },
      ]);
      const lowConfidence = extracted.confidence < 0.4;
      const status = verificationStatus === "conflict" || lowConfidence ? "candidate" : "active";
      const flags = lowConfidence ? ["low_confidence"] : [];
      // Only the athletics feed reports where a game is played. Flagging it
      // here rather than at selection keeps the fact with the event, so a
      // road game stays excluded no matter which post later considers it.
      if (isAwayIndicator(raw.rawMetadata?.locationIndicator)) flags.push(AWAY_GAME_FLAG);

      const [event] = await db
        .insert(events)
        .values({
          schoolId,
          name: extracted.event_name ?? "Untitled event",
          description: extracted.description,
          startAt: new Date(parsedDates.startAt),
          endAt: parsedDates.endAt ? new Date(parsedDates.endAt) : null,
          venue: extracted.venue,
          city: extracted.city,
          price: extracted.price,
          ageRequirement: extracted.age_requirement,
          category,
          tags: [category],
          organization: extracted.organization,
          sourceUrl: raw.sourceUrl,
          sourceName: source.name,
          sourceImage: raw.mediaUrl,
          originalRawContentId: raw.id,
          confidenceScore: extracted.confidence,
          fieldConfidence: buildFieldConfidence(extracted),
          relevanceScore: bucketScores.overall,
          bucketScores,
          verificationStatus,
          status,
          flags,
        })
        .returning();
      if (!event) throw new Error("Insert returned no row");

      await db.insert(eventSources).values({
        eventId: event.id,
        rawContentId: raw.id,
        sourceId: source.id,
        sourceUrl: raw.sourceUrl,
      });

      await db
        .update(rawContent)
        .set({ processingStatus: "processed", rawMetadata: enrichedMetadata })
        .where(eq(rawContent.id, raw.id));
      summary.created++;
    } catch (err) {
      summary.errored++;
      await db
        .update(rawContent)
        .set({ processingStatus: "error" })
        .where(eq(rawContent.id, raw.id));
      await log(schoolId, "error", "ai.extract_event", `Failed to process raw_content ${raw.id}: ${(err as Error).message}`, {
        rawContentId: raw.id,
      });
    }
  }

  return summary;
}

/**
 * Decides an event's category, honouring a source-level pin when one is
 * configured (`sources.metadata.forceCategory`).
 *
 * Some sources are single-purpose by nature — Posh.vip only ever lists
 * nightlife — and letting per-event AI/keyword classification override that
 * is a net loss: a nightclub promo whose caption happens to say "live music"
 * or "free food" gets classified as concert/food_drink and then, under the
 * lane rules in core/logic/lanes.ts, either lands in the wrong post or falls
 * out of the schedule entirely. Pinning at the source is both more accurate
 * and the mechanism that guarantees these events can only reach the
 * nightlife lane.
 */
function resolveCategory(
  source: typeof sources.$inferSelect,
  extracted: { event_name: string | null; description: string | null; category: string | null },
): EventCategory {
  const forced = source.metadata?.forceCategory;
  if (typeof forced === "string" && (EVENT_CATEGORIES as readonly string[]).includes(forced)) {
    return forced as EventCategory;
  }
  return (
    (extracted.category as EventCategory | null) ??
    categorizeEvent({ name: extracted.event_name ?? "", description: extracted.description }).category
  );
}

function buildFieldConfidence(extracted: {
  event_name: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  price: string | null;
  category: string | null;
  confidence: number;
}) {
  const c = extracted.confidence;
  return {
    eventName: extracted.event_name ? c : 0,
    date: extracted.date ? c : 0,
    startTime: extracted.start_time ? c : 0,
    endTime: extracted.end_time ? c : 0,
    venue: extracted.venue ? c : 0,
    price: extracted.price ? c : 0,
    category: extracted.category ? c : 0,
  };
}

interface MergeArgs {
  schoolId: string;
  school: typeof schools.$inferSelect;
  existingEventId: string;
  rawContentId: string;
  source: typeof sources.$inferSelect;
  extracted: {
    event_name: string | null;
    venue: string | null;
    city: string | null;
    price: string | null;
    age_requirement: string | null;
    description: string | null;
    organization: string | null;
  };
  parsedStartAt: string;
}

/**
 * Links a newly-discovered raw_content item to an existing event (spec
 * §15) instead of creating a duplicate, then recomputes that event's
 * verification status from ALL of its now-linked sources — including
 * detecting a fresh CONFLICT if this new observation disagrees on timing.
 * When the new source is more authoritative than every source already
 * backing the event, its descriptive fields win (spec: "prefer the most
 * authoritative information").
 */
async function mergeIntoExistingEvent(args: MergeArgs): Promise<void> {
  const { schoolId, existingEventId, rawContentId, source, extracted, parsedStartAt } = args;

  await db.insert(eventSources).values({
    eventId: existingEventId,
    rawContentId,
    sourceId: source.id,
    sourceUrl: null,
  });

  const links = await db
    .select({ sourcePriority: sources.priority, sourceId: sources.id, rawMetadata: rawContent.rawMetadata })
    .from(eventSources)
    .innerJoin(sources, eq(eventSources.sourceId, sources.id))
    .innerJoin(rawContent, eq(eventSources.rawContentId, rawContent.id))
    .where(eq(eventSources.eventId, existingEventId));

  const observations = links.map((l) => ({
    sourceId: l.sourceId,
    sourcePriority: l.sourcePriority,
    startAt: (l.rawMetadata as { observedStartAt?: string })?.observedStartAt ?? parsedStartAt,
  }));

  const { status: verificationStatus, reason } = computeVerificationStatus(observations);

  const [existing] = await db.select().from(events).where(eq(events.id, existingEventId)).limit(1);
  if (!existing) return;

  const existingSourcePriorities = await db
    .select({ priority: sources.priority })
    .from(eventSources)
    .innerJoin(sources, eq(eventSources.sourceId, sources.id))
    .where(and(eq(eventSources.eventId, existingEventId), ne(eventSources.sourceId, source.id)));
  const maxOtherPriority = Math.max(0, ...existingSourcePriorities.map((p) => p.priority));
  const newSourceIsMoreAuthoritative = source.priority > maxOtherPriority;

  await db
    .update(events)
    .set({
      ...(newSourceIsMoreAuthoritative
        ? {
            name: extracted.event_name ?? existing.name,
            venue: extracted.venue ?? existing.venue,
            city: extracted.city ?? existing.city,
            price: extracted.price ?? existing.price,
            ageRequirement: extracted.age_requirement ?? existing.ageRequirement,
            description: extracted.description ?? existing.description,
            organization: extracted.organization ?? existing.organization,
          }
        : {}),
      verificationStatus,
      status: verificationStatus === "conflict" ? "candidate" : existing.status === "candidate" ? "active" : existing.status,
      flags:
        verificationStatus === "conflict"
          ? Array.from(new Set([...existing.flags, `CONFLICT — time (${reason})`]))
          : existing.flags,
      updatedAt: new Date(),
    })
    .where(eq(events.id, existingEventId));
}
