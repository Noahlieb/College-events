import { and, eq, gte, inArray } from "drizzle-orm";
import { db, posts, schools } from "@college-events/db";
import { mondayOfWeek } from "../lib/week.js";
import { renderPost } from "./render.js";
import { log } from "../lib/log.js";

export interface RenderAllResult {
  postId: string;
  postType: string;
  scheduledDate: string;
  slideCount: number | null;
  error?: string;
}

/**
 * Renders every post from the current week onward that is still eligible
 * to change (draft / needs_review / ready_for_approval / approved).
 *
 * Intended for the nightly automation: post content is rebuilt from
 * scratch on every selection run, so a previously-rendered carousel can
 * silently disagree with its own event list once a new event lands in that
 * week. Re-rendering keeps the dashboard preview honest.
 *
 * Published posts are skipped — their images are already out on Instagram,
 * and regenerating them would only overwrite the artifact of something
 * that has shipped. Past weeks are skipped for the same reason plus cost.
 *
 * One post failing never aborts the batch; each error is captured per-post
 * and logged, because a single unreachable source image should not stop
 * the rest of the week's posts from rendering.
 */
export async function renderAllPosts(schoolId: string, referenceDate: Date = new Date()): Promise<RenderAllResult[]> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school ${schoolId}`);

  const fromDate = mondayOfWeek(referenceDate).toISOString().slice(0, 10);

  const targets = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.schoolId, schoolId),
        gte(posts.scheduledDate, fromDate),
        inArray(posts.status, ["draft", "needs_review", "ready_for_approval", "approved"]),
      ),
    )
    .orderBy(posts.scheduledDate);

  const results: RenderAllResult[] = [];

  for (const post of targets) {
    try {
      const result = await renderPost(post.id);
      results.push({
        postId: post.id,
        postType: post.postType,
        scheduledDate: post.scheduledDate,
        slideCount: result.slideCount,
      });
    } catch (err) {
      const message = (err as Error).message;
      results.push({
        postId: post.id,
        postType: post.postType,
        scheduledDate: post.scheduledDate,
        slideCount: null,
        error: message,
      });
      await log(schoolId, "error", "render", `Render failed for post ${post.id} (${post.scheduledDate}): ${message}`, {
        postId: post.id,
      });
    }
  }

  return results;
}
