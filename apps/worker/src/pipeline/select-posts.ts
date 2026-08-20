import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db, events, postEvents, posts, schools } from "@college-events/db";
import {
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

const MAX_SLIDES_PER_POST = 8;

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
 * Builds/refreshes this week's carousel posts for a school (spec §19/§20).
 * One post per slot in the school's weeklySchedule, each drawing from the
 * SAME pool of this-week active events but ranked by that slot's own
 * bucket score — a nightlife event naturally sorts to the top of Thursday
 * and to the bottom of Monday. Never pads a post with weak events just to
 * hit the slide cap; a post with fewer strong events ships with fewer slides.
 */
export async function selectWeeklyPosts(
  schoolId: string,
  aiProvider: AIProvider = createAIProvider(),
  referenceDate: Date = new Date(),
): Promise<PostBuildResult[]> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school ${schoolId}`);

  const weekMonday = mondayOfWeek(referenceDate);
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
      const laneEvent = { category: e.category, startAt: e.startAt.toISOString(), timezone: school.timezone };
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

    const hasNeedsReview = selectedEvents.some((e) => e.verificationStatus === "needs_review");
    const status = selectedEvents.length === 0 ? "draft" : hasNeedsReview ? "needs_review" : "ready_for_approval";

    let postId: string;
    if (existingPost) {
      postId = existingPost.id;
      await db.update(posts).set({ status, updatedAt: new Date() }).where(eq(posts.id, postId));
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
          events: selectedEvents.map((e) => ({ name: e.name, venue: e.venue, date: e.startAt.toISOString().slice(0, 10) })),
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
