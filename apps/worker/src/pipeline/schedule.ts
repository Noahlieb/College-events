import { asc, eq } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import { db, posts, renderedAssets, schools } from "@college-events/db";
import { createSchedulerProvider, type SchedulerProvider } from "@college-events/scheduler";
import type { WeeklyScheduleSlot } from "@college-events/core";
import { log } from "../lib/log.js";

export interface SchedulePostResult {
  schedulerPostId: string;
  status: string;
  scheduledAt: string;
}

/**
 * Sends an approved post to the scheduler (Buffer, or the mock in dev/
 * demo — spec §25/§26). Computes the actual publish time from the school's
 * configured weekly schedule slot (hour/minute, in the school's own
 * timezone) rather than a hardcoded time, since future schools may publish
 * on a different cadence.
 */
export async function schedulePost(
  postId: string,
  scheduler: SchedulerProvider = createSchedulerProvider(),
): Promise<SchedulePostResult> {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) throw new Error(`Unknown post ${postId}`);
  if (post.status !== "approved") {
    throw new Error(`Post ${postId} must be APPROVED before scheduling (status=${post.status})`);
  }
  if (!post.caption) throw new Error(`Post ${postId} has no caption — run render/select-posts first`);

  const [school] = await db.select().from(schools).where(eq(schools.id, post.schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school for post ${postId}`);

  const assets = await db
    .select()
    .from(renderedAssets)
    .where(eq(renderedAssets.postId, postId))
    .orderBy(asc(renderedAssets.createdAt));
  if (assets.length === 0) throw new Error(`Post ${postId} has no rendered assets — run render first`);

  const schedule = school.weeklySchedule;
  const slot = schedule.find((s) => s.postType === post.postType);
  const hour = slot?.hour ?? 9;
  const minute = slot?.minute ?? 0;
  const localDateTime = new Date(
    `${post.scheduledDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
  );
  const scheduledAt = fromZonedTime(localDateTime, school.timezone).toISOString();

  const profileEnvKey = `BUFFER_PROFILE_ID_${school.shortName.toUpperCase()}`;
  const profileId = process.env[profileEnvKey] || `mock-profile-${school.shortName.toLowerCase()}`;

  const result = await scheduler.schedulePost({
    profileId,
    imageUrls: assets.map((a) => a.storageUrl),
    caption: post.caption,
    scheduledAt,
    externalRef: postId,
  });

  await db
    .update(posts)
    .set({ status: "scheduled", schedulerId: result.schedulerPostId, updatedAt: new Date() })
    .where(eq(posts.id, postId));

  await log(post.schoolId, "info", "scheduler", `Post ${postId} scheduled via ${scheduler.name} for ${scheduledAt}`, {
    postId,
    schedulerPostId: result.schedulerPostId,
  });

  return { schedulerPostId: result.schedulerPostId, status: result.status, scheduledAt };
}
