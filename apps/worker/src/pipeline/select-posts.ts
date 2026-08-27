import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db, events, postEvents, posts, schools } from "@college-events/db";
import {
  AWAY_GAME_FLAG,
  assertLanePurity,
  isEventAllowedInLane,
  laneForEvent,
  laneForPostType,
  selectEventsForPost,
  type WeeklyScheduleSlot,
} from "@college-events/core";
import { createAIProvider, type AIProvider } from "@college-events/ai";
import { log } from "../lib/log.js";
import { mondayOfWeek } from "../lib/week.js";
import { formatCaptionDayLabel, formatCaptionTimeRange, formatInstagramHandle, formatWeekRangeSentence } from "../lib/format.js";

const MAX_SLIDES_PER_POST = 8;

/**
 * Reads home/away back off an event's flags. Only the athletics feed knows
 * this, so an unflagged event returns undefined ("unknown"), which lanes.ts
 * treats as postable — see LaneEvent.isHomeGame.
 */
function isHomeGame(flags: string[]): boolean | undefined {
  return flags.includes(AWAY_GAME_FLAG) ? false : undefined;
}

/**
 * How many weeks past the current one to build posts for. Posts for future
 * weeks are real, editable rows from the moment a single event lands in
 * them, so an event scraped today for three weeks out immediately starts
 * assembling its post instead of appearing the week it happens.
 */
const DEFAULT_WEEKS_AHEAD = 3;

export interface PostBuildResult {
  postId: string;
  postType: string;
  scheduledDate: string;
  eventCount: number;
  status: string;
}

function scheduledDateFor(weekMonday: Date, slot: WeeklyScheduleSlot): string {
  const daysFromMonday = (slot.dayOfWeek - 1 + 7) % 7;
  const d = new Date(weekMonday);
  d.setUTCDate(d.getUTCDate() + daysFromMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds/refreshes carousel posts for the current week and the next
 * `weeksAhead` weeks (spec §19/§20). One post per lane per week, each
 * drawing only from events falling inside that week and ranked by the
 * lane's own bucket score. Never pads a post with weak events just to hit
 * the slide cap; a post with fewer strong events ships with fewer slides.
 *
 * Safe and expected to re-run — every unlocked post is rebuilt from
 * scratch on each run, so newly-scraped events flow into their week's post
 * automatically. Posts a human has already approved/scheduled/published
 * are left untouched, so a rebuild can never overwrite curated content.
 */
export async function selectWeeklyPosts(
  schoolId: string,
  aiProvider: AIProvider = createAIProvider(),
  referenceDate: Date = new Date(),
  weeksAhead: number = DEFAULT_WEEKS_AHEAD,
): Promise<PostBuildResult[]> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school ${schoolId}`);

  const currentMonday = mondayOfWeek(referenceDate);
  const results: PostBuildResult[] = [];

  for (let weekOffset = 0; weekOffset <= weeksAhead; weekOffset++) {
    const weekMonday = new Date(currentMonday);
    weekMonday.setUTCDate(weekMonday.getUTCDate() + weekOffset * 7);
    results.push(...(await buildWeek({ schoolId, school, aiProvider, referenceDate, weekMonday })));
  }

  return results;
}

interface BuildWeekArgs {
  schoolId: string;
  school: typeof schools.$inferSelect;
  aiProvider: AIProvider;
  referenceDate: Date;
  weekMonday: Date;
}

/**
 * Builds/refreshes every lane's post for ONE week. Split out from
 * selectWeeklyPosts so the horizon loop above stays readable, and so each
 * week's event pool is scoped to that week rather than leaking across.
 */
async function buildWeek({
  schoolId,
  school,
  aiProvider,
  referenceDate,
  weekMonday,
}: BuildWeekArgs): Promise<PostBuildResult[]> {
  const weekEnd = new Date(weekMonday);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const weekEvents = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.schoolId, schoolId),
        inArray(events.status, ["active", "selected"]),
        gte(events.startAt, weekMonday),
        lt(events.startAt, weekEnd),
      ),
    );

  const schedule = school.weeklySchedule;
  const results: PostBuildResult[] = [];

  for (const slot of schedule) {
    const lane = laneForPostType(slot.postType);
    if (!lane) continue;

    const selectable = weekEvents.map((e) => ({
      id: e.id,
      category: e.category,
      bucketScores: e.bucketScores,
      verificationStatus: e.verificationStatus,
      startAt: e.startAt.toISOString(),
      isHomeGame: isHomeGame(e.flags),
      manualLane: e.manualLane,
    }));

    const selected = selectEventsForPost(selectable, {
      postType: slot.postType,
      bucket: lane.bucket,
      timezone: school.timezone,
      maxSlides: MAX_SLIDES_PER_POST,
      now: referenceDate,
    });
    const selectedIds = new Set(selected.map((s) => s.id));

    // Dashboard "force include" (spec §23) bypasses the score/cap filters —
    // an admin's manual override always wins a slide, even past maxSlides.
    // It does NOT bypass the lane's category rule: forcing a nightlife event
    // into the campus post is exactly the mix-up the lanes exist to prevent,
    // so an out-of-lane force_include is skipped and logged rather than
    // failing the whole post build.
    const forcedInLane: typeof weekEvents = [];
    for (const e of weekEvents) {
      if (selectedIds.has(e.id) || !e.flags.includes("force_include")) continue;
      const laneEvent = {
        category: e.category,
        startAt: e.startAt.toISOString(),
        timezone: school.timezone,
        isHomeGame: isHomeGame(e.flags),
        manualLane: e.manualLane,
      };
      if (isEventAllowedInLane(slot.postType, laneEvent)) {
        forcedInLane.push(e);
      } else {
        await log(
          schoolId,
          "warn",
          "select_posts",
          `Ignoring force_include for event ${e.id} (${e.category}) in ${slot.postType}: it routes to ` +
            `${laneForEvent(laneEvent)?.postType ?? "no post"} instead.`,
          { eventId: e.id },
        );
      }
    }

    const selectedEvents = [...selected.map((s) => weekEvents.find((e) => e.id === s.id)!), ...forcedInLane].sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime(),
    ); // chronological within the carousel

    // Last gate before anything is written. Selection and the force_include
    // path above both filter by category already, so a failure here means a
    // logic bug — better to abort this post than publish mixed content.
    assertLanePurity(
      slot.postType,
      selectedEvents.map((e) => ({
        id: e.id,
        category: e.category,
        startAt: e.startAt.toISOString(),
        timezone: school.timezone,
        isHomeGame: isHomeGame(e.flags),
        manualLane: e.manualLane,
      })),
    );

    const scheduledDate = scheduledDateFor(weekMonday, slot);

    const [existingPost] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.schoolId, schoolId), eq(posts.postType, slot.postType), eq(posts.scheduledDate, scheduledDate)))
      .limit(1);

    // A post a human has already approved/scheduled/published is locked —
    // re-running selection must never silently overwrite curated content.
    if (existingPost && ["approved", "scheduled", "published"].includes(existingPost.status)) {
      results.push({
        postId: existingPost.id,
        postType: slot.postType,
        scheduledDate,
        eventCount: selectedEvents.length,
        status: `${existingPost.status} (locked, not rebuilt)`,
      });
      continue;
    }

    // Don't conjure empty rows for future weeks nothing has landed in yet —
    // with a multi-week horizon that would fill the dashboard with blank
    // drafts. An existing post that has emptied out is still updated below,
    // so a post never silently keeps stale events.
    if (selectedEvents.length === 0 && !existingPost) continue;

    const hasNeedsReview = selectedEvents.some((e) => e.verificationStatus === "needs_review");
    const status = selectedEvents.length === 0 ? "draft" : hasNeedsReview ? "needs_review" : "ready_for_approval";

    let postId: string;
    if (existingPost) {
      postId = existingPost.id;
      // title tracks slot.label too, not just status — otherwise an admin
      // renaming a lane's label (e.g. "Weekend Guide" -> "Nightlife
      // Events") only ever takes effect on posts created after the rename;
      // every already-existing unlocked post keeps showing the old label
      // on its cover slide and in the dashboard forever, since rebuilding
      // it never touches title at all.
      await db.update(posts).set({ status, title: slot.label, updatedAt: new Date() }).where(eq(posts.id, postId));
      await db.delete(postEvents).where(eq(postEvents.postId, postId));
    } else {
      const [created] = await db
        .insert(posts)
        .values({ schoolId, postType: slot.postType, scheduledDate, title: slot.label, status })
        .returning();
      if (!created) throw new Error("Failed to create post");
      postId = created.id;
    }

    for (let i = 0; i < selectedEvents.length; i++) {
      await db.insert(postEvents).values({ postId, eventId: selectedEvents[i]!.id, position: i, slideNumber: i + 2 }); // slide 1 is the cover
    }

    if (selectedEvents.length > 0) {
      try {
        const caption = await aiProvider.generateCaption({
          postType: slot.postType as never,
          schoolName: school.name,
          schoolShortName: school.shortName,
          city: school.city,
          instagramHandle: formatInstagramHandle(school.instagramAccount, school.shortName),
          weekRangeLabel: formatWeekRangeSentence(weekMonday),
          events: selectedEvents.map((e) => ({
            name: e.name,
            venue: e.venue,
            dayLabel: formatCaptionDayLabel(e.startAt.toISOString(), school.timezone),
            time: formatCaptionTimeRange(e.startAt.toISOString(), e.endAt?.toISOString() ?? null, school.timezone),
          })),
        });
        await db.update(posts).set({ caption: caption.caption }).where(eq(posts.id, postId));
      } catch (err) {
        await log(schoolId, "warn", "caption", `Caption generation failed for post ${postId}: ${(err as Error).message}`);
      }
    }

    results.push({ postId, postType: slot.postType, scheduledDate, eventCount: selectedEvents.length, status });
  }

  return results;
}
