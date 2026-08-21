import { eq } from "drizzle-orm";
import { db, posts } from "@college-events/db";
import { log } from "../lib/log.js";

/**
 * Human approval gate (spec §22). The MVP never auto-publishes — every
 * post sits at READY_FOR_APPROVAL or NEEDS_REVIEW until a person calls
 * this. Rejects a status that isn't actually awaiting approval rather than
 * silently approving something mid-pipeline.
 */
export async function approvePost(postId: string, approvedBy: string): Promise<void> {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) throw new Error(`Unknown post ${postId}`);
  if (!["ready_for_approval", "needs_review"].includes(post.status)) {
    throw new Error(`Post ${postId} is not awaiting approval (status=${post.status})`);
  }
  await db
    .update(posts)
    .set({ status: "approved", approvedBy, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(posts.id, postId));
  await log(post.schoolId, "info", "approval", `Post ${postId} approved by ${approvedBy}`, { postId });
}

export async function rejectPost(postId: string, reason: string, rejectedBy: string): Promise<void> {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) throw new Error(`Unknown post ${postId}`);
  await db.update(posts).set({ status: "rejected", updatedAt: new Date() }).where(eq(posts.id, postId));
  await log(post.schoolId, "info", "approval", `Post ${postId} rejected by ${rejectedBy}: ${reason}`, { postId });
}
