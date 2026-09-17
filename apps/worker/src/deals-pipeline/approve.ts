import { eq } from "drizzle-orm";
import { db, dealContentPosts } from "@college-events/db";
import { log } from "../lib/log.js";

/** Human approval gate for the deals content queue (spec Phase 9's
 * explicit "do NOT automatically publish"). Mirrors the events product's
 * approvePost/rejectPost. */
export async function approveDealContentPost(postId: string, approvedBy: string): Promise<void> {
  const [post] = await db.select().from(dealContentPosts).where(eq(dealContentPosts.id, postId)).limit(1);
  if (!post) throw new Error(`Unknown deal content post ${postId}`);
  if (!["ready_for_approval", "needs_review", "draft"].includes(post.status)) {
    throw new Error(`Deal content post ${postId} is not awaiting approval (status=${post.status})`);
  }
  await db
    .update(dealContentPosts)
    .set({ status: "approved", approvedBy, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(dealContentPosts.id, postId));
  await log(post.universityId, "info", "deals.approval", `Deal content post ${postId} approved by ${approvedBy}`, { postId });
}

export async function rejectDealContentPost(postId: string, reason: string, rejectedBy: string): Promise<void> {
  const [post] = await db.select().from(dealContentPosts).where(eq(dealContentPosts.id, postId)).limit(1);
  if (!post) throw new Error(`Unknown deal content post ${postId}`);
  await db.update(dealContentPosts).set({ status: "rejected", updatedAt: new Date() }).where(eq(dealContentPosts.id, postId));
  await log(post.universityId, "info", "deals.approval", `Deal content post ${postId} rejected by ${rejectedBy}: ${reason}`, {
    postId,
  });
}
