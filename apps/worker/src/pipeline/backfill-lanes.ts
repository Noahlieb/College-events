import { and, eq, inArray, ne } from "drizzle-orm";
import { db, events, eventSources, posts, rawContent, schools, sources } from "@college-events/db";
import {
  AWAY_GAME_FLAG,
  isAwayIndicator,
  EVENT_CATEGORIES,
  POST_LANES,
  daysUntil,
  scoreEvent,
  type EventCategory,
  type SourceCategory,
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
  /** Existing posts whose post type no longer maps to a lane. Left in
   * place (they are real history) but never rebuilt again. */
  postsOrphaned: number;
  /** Sports events found to be away/neutral-site and newly flagged, so they
   * stop appearing in posts. */
  awayGamesFlagged: number;
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
    awayGamesFlagged: 0,
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
  for (const src of schoolSources) {
    const pin = PINS[src.name];
    if (!pin) continue;
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
  //
  //    Every non-rejected event is rescored, not just the pinned ones: the
  //    bucket-affinity table itself changed when sports gained a lane on
  //    both posts (mondayCampus 0.75→1.1, thursdayNightlife 0.2→1.05), so
  //    every stored score predating that is stale. A Saturday game would
  //    otherwise route to the weekend post correctly and then fall under
  //    the min-score cutoff and silently disappear.
  const links = await db
    .select({ eventId: eventSources.eventId, sourceId: eventSources.sourceId })
    .from(eventSources)
    .innerJoin(sources, eq(eventSources.sourceId, sources.id))
    .where(eq(sources.schoolId, schoolId));

  const pinnedCategoryByEvent = new Map<string, EventCategory>();
  // Source category drives the campus-affiliation bonus, exactly as it does
  // on the original ingest path — assuming "nearby" for everything here
  // would quietly strip that bonus from every campus event and could push
  // it under the selection cutoff. Where an event has several sources, the
  // highest-priority one wins, matching how the rest of the pipeline
  // resolves conflicting sources.
  const sourceCategoryByEvent = new Map<string, { category: SourceCategory; priority: number }>();
  for (const link of links) {
    const src = schoolSources.find((s) => s.id === link.sourceId);
    if (!src) continue;

    const pin = PINS[src.name];
    if (pin) pinnedCategoryByEvent.set(link.eventId, pin);

    const best = sourceCategoryByEvent.get(link.eventId);
    if (!best || src.priority > best.priority) {
      sourceCategoryByEvent.set(link.eventId, { category: src.category, priority: src.priority });
    }
  }

  const allEvents = await db
    .select()
    .from(events)
    .where(and(eq(events.schoolId, schoolId), ne(events.status, "rejected")));

  for (const event of allEvents) {
    const target = pinnedCategoryByEvent.get(event.id) ?? event.category;
    const needsRecategorize = event.category !== target;
    const bucketScores = scoreEvent({
      category: target,
      distanceMiles: estimateDistanceMiles(event.city, school.city),
      priceText: event.price,
      isCampusAffiliated: isCampusAffiliated(
        event.organization,
        school.name,
        school.shortName,
        sourceCategoryByEvent.get(event.id)?.category ?? "nearby",
      ),
      daysUntilStart: daysUntil(event.startAt.toISOString(), school.timezone),
    });

    if (needsRecategorize) summary.eventsRecategorized++;
    summary.eventsRescored++;

    if (!dryRun) {
      await db
        .update(events)
        .set({
          category: target,
          tags: Array.from(
            new Set([target, ...event.tags.filter((t) => (EVENT_CATEGORIES as readonly string[]).includes(t))]),
          ),
          bucketScores,
          relevanceScore: bucketScores.overall,
          updatedAt: new Date(),
        })
        .where(eq(events.id, event.id));
    }
  }

  // 4. Flag sports events that are away/neutral-site games. Events created
  //    before home/away routing existed carry no flag, so they would keep
  //    appearing in posts until something re-created them -- and nothing
  //    ever does, since process.ts only touches new raw content. The
  //    indicator is read back off the raw content each event came from.
  const sportsEvents = await db
    .select({ id: events.id, name: events.name, flags: events.flags, rawId: events.originalRawContentId })
    .from(events)
    .where(and(eq(events.schoolId, schoolId), eq(events.category, "sports"), ne(events.status, "rejected")));

  const unflagged = sportsEvents.filter((e) => !e.flags.includes(AWAY_GAME_FLAG));
  if (unflagged.length > 0) {
    const raws = await db
      .select({ id: rawContent.id, rawMetadata: rawContent.rawMetadata })
      .from(rawContent)
      .where(inArray(rawContent.id, unflagged.map((e) => e.rawId)));
    const indicatorById = new Map(raws.map((r) => [r.id, r.rawMetadata?.locationIndicator]));

    for (const event of unflagged) {
      if (!isAwayIndicator(indicatorById.get(event.rawId))) continue;
      summary.awayGamesFlagged++;
      if (!dryRun) {
        await db
          .update(events)
          .set({ flags: [...event.flags, AWAY_GAME_FLAG], updatedAt: new Date() })
          .where(eq(events.id, event.id));
      }
    }
  }

  // 5. Report posts whose type no longer has a lane. They are left in place
  //    rather than deleted — they are real published/approved history — but
  //    select-posts will never rebuild them again, so an operator needs to
  //    know they are now frozen rather than quietly stale.
  const orphanedPosts = await db
    .select({ id: posts.id, postType: posts.postType, scheduledDate: posts.scheduledDate })
    .from(posts)
    .where(eq(posts.schoolId, schoolId));
  summary.postsOrphaned = orphanedPosts.filter((p) => !laneTypes.has(p.postType)).length;

  if (!dryRun) {
    await log(
      schoolId,
      "info",
      "backfill_lanes",
      `Lane backfill: schedule ${summary.scheduleSlotsBefore}→${summary.scheduleSlotsAfter} slots, ` +
        `${summary.sourcesPinned.length} source(s) pinned, ${summary.eventsRecategorized} event(s) recategorized, ` +
        `${summary.eventsRescored} rescored, ${summary.awayGamesFlagged} away game(s) flagged, ` +
        `${summary.postsOrphaned} post(s) left orphaned by retired post types.`,
    );
  }

  return summary;
}
