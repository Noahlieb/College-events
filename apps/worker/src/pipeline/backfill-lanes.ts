import { and, eq, inArray, ne } from "drizzle-orm";
import { db, events, eventSources, schools, sources } from "@college-events/db";
import {
  EVENT_CATEGORIES,
  POST_LANES,
  daysUntil,
  scoreEvent,
  type EventCategory,
  type WeeklyScheduleSlot,
} from "@college-events/core";
import { estimateDistanceMiles, isCampusAffiliated } from "../lib/geo-heuristic.js";
import { log } from "../lib/log.js";

export interface BackfillSummary {
  scheduleSlotsBefore: number;
  scheduleSlotsAfter: number;
  sourcesPinned: { name: string; forceCategory: string }[];
  eventsRecategorized: number;
  eventsRescored: number;
  postsOrphaned: number;
}

/**
 * Brings an existing database in line with the current lane rules (see
 * core/logic/lanes.ts). Idempotent — safe to re-run.
 *
 * Deliberately a worker command rather than a SQL migration: two of the
 * four steps need the real scoring/geo logic, which only exists in
 * TypeScript. Hand-porting `scoreEvent` into SQL would leave two
 * implementations of the business rule to drift apart, and getting it
 * subtly wrong would silently mis-rank every backfilled event.
 */
export async function backfillLanes(schoolId: string, dryRun = false): Promise<BackfillSummary> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school ${schoolId}`);

  const summary: BackfillSummary = {
    scheduleSlotsBefore: school.weeklySchedule.length,
    scheduleSlotsAfter: school.weeklySchedule.length,
    sourcesPinned: [],
    eventsRecategorized: 0,
    eventsRescored: 0,
    postsOrphaned: 0,
  };

  // 1. Drop schedule slots whose post type no longer has a lane (midweek).
  const laneTypes = new Set(POST_LANES.map((l) => l.postType));
  const keptSlots = school.weeklySchedule.filter((s: WeeklyScheduleSlot) => laneTypes.has(s.postType));
  summary.scheduleSlotsAfter = keptSlots.length;
  if (!dryRun && keptSlots.length !== school.weeklySchedule.length) {
    await db.update(schools).set({ weeklySchedule: keptSlots, updatedAt: new Date() }).where(eq(schools.id, schoolId));
  }

  // 2. Pin single-purpose sources to their category. Keyed by source name
  //    since that is what the operator sees in the dashboard and what
  //    `import-csv --source=` already matches on.
  const PINS: Record<string, EventCategory> = { "Posh.vip Nightlife": "nightlife" };
  const schoolSources = await db.select().from(sources).where(eq(sources.schoolId, schoolId));
  const pinnedSourceIds: string[] = [];
  for (const src of schoolSources) {
    const pin = PINS[src.name];
    if (!pin) continue;
    pinnedSourceIds.push(src.id);
    summary.sourcesPinned.push({ name: src.name, forceCategory: pin });
    if (!dryRun && src.metadata?.forceCategory !== pin) {
      await db
        .update(sources)
        .set({ metadata: { ...src.metadata, forceCategory: pin }, updatedAt: new Date() })
        .where(eq(sources.id, src.id));
    }
  }

  // 3. Re-apply those pins to events the pinned sources already produced,
  //    and rescore them — an event classified `concert` before the pin
  //    carries a nightlife bucket score computed with the wrong affinity,
  //    so recategorizing without rescoring would leave it correctly routed
  //    but ranked as if it were still out of place.
  if (pinnedSourceIds.length > 0) {
    const linked = await db
      .selectDistinct({ eventId: eventSources.eventId, sourceId: eventSources.sourceId })
      .from(eventSources)
      .where(inArray(eventSources.sourceId, pinnedSourceIds));

    const targetCategoryByEvent = new Map<string, EventCategory>();
    for (const link of linked) {
      const src = schoolSources.find((s) => s.id === link.sourceId);
      const pin = src ? PINS[src.name] : undefined;
      if (pin) targetCategoryByEvent.set(link.eventId, pin);
    }

    if (targetCategoryByEvent.size > 0) {
      const rows = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.schoolId, schoolId),
            ne(events.status, "rejected"),
            inArray(events.id, [...targetCategoryByEvent.keys()]),
          ),
        );

      for (const event of rows) {
        const target = targetCategoryByEvent.get(event.id)!;
        const needsRecategorize = event.category !== target;
        const bucketScores = scoreEvent({
          category: target,
          distanceMiles: estimateDistanceMiles(event.city, school.city),
          priceText: event.price,
          isCampusAffiliated: isCampusAffiliated(event.organization, school.name, school.shortName, "nearby"),
          daysUntilStart: daysUntil(event.startAt.toISOString(), school.timezone),
        });

        if (needsRecategorize) summary.eventsRecategorized++;
        summary.eventsRescored++;

        if (!dryRun) {
          await db
            .update(events)
            .set({
              category: target,
              tags: Array.from(new Set([target, ...event.tags.filter((t) => (EVENT_CATEGORIES as readonly string[]).includes(t))])),
              bucketScores,
              relevanceScore: bucketScores.overall,
              updatedAt: new Date(),
            })
            .where(eq(events.id, event.id));
        }
      }
    }
  }

  if (!dryRun) {
    await log(
      schoolId,
      "info",
      "backfill_lanes",
      `Lane backfill: schedule ${summary.scheduleSlotsBefore}→${summary.scheduleSlotsAfter} slots, ` +
        `${summary.sourcesPinned.length} source(s) pinned, ${summary.eventsRecategorized} event(s) recategorized, ` +
        `${summary.eventsRescored} rescored.`,
    );
  }

  return summary;
}
