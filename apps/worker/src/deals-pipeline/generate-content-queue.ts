import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, dealContentPostDeals, dealContentPosts, deals, merchants, schools } from "@college-events/db";
import { buildWeeklyContentQueue, type ContentPostSlot, type QueueableDeal } from "@college-events/core";
import { mondayOfWeek } from "../lib/week.js";

export interface ContentQueueResult {
  postId: string;
  slot: ContentPostSlot;
  scheduledDate: string;
  dealCount: number;
  status: string;
}

type WeeklySlot = Exclude<ContentPostSlot, "story">;

const SLOT_DAY_OFFSET: Record<WeeklySlot, number> = {
  monday_top5: 0,
  tuesday_deal: 1,
  wednesday_local: 2,
  friday_weekend: 4,
  sunday_roundup: 6,
};

const SLOT_TITLES: Record<WeeklySlot, string> = {
  monday_top5: "5 Best Deals This Week",
  tuesday_deal: "Deal of the Day",
  wednesday_local: "Local Deal of the Week",
  friday_weekend: "Weekend Deal",
  sunday_roundup: "This Week's Roundup",
};

const WEEKLY_SLOTS: WeeklySlot[] = ["monday_top5", "tuesday_deal", "wednesday_local", "friday_weekend", "sunday_roundup"];

/**
 * Builds the proposed weekly content queue for a university (spec Phase 9):
 * Monday top 5, Tuesday deal, Wednesday local deal, Friday weekend deal,
 * Sunday roundup — each a `deal_content_posts` row in `ready_for_approval`
 * status. Nothing here publishes anything; a human still has to approve
 * (spec Phase 9's explicit "do NOT automatically publish").
 *
 * Safe to re-run: an unlocked post is rebuilt from scratch each time, but
 * approved/scheduled/published posts are left untouched, mirroring the
 * events product's selectWeeklyPosts.
 */
export async function generateWeeklyContentQueue(
  universityId: string,
  referenceDate: Date = new Date(),
): Promise<ContentQueueResult[]> {
  const [university] = await db.select().from(schools).where(eq(schools.id, universityId)).limit(1);
  if (!university) throw new Error(`Unknown university ${universityId}`);

  const activeDeals = await db
    .select({ deal: deals, merchant: merchants })
    .from(deals)
    .innerJoin(merchants, eq(deals.merchantId, merchants.id))
    .where(
      and(
        eq(deals.universityId, universityId),
        ne(deals.contentEligibility, "reject"),
        ne(deals.freshnessStatus, "expired"),
      ),
    );

  const today = referenceDate.toISOString().slice(0, 10);
  const queueable: QueueableDeal[] = activeDeals.map(({ deal }) => ({
    id: deal.id,
    merchantId: deal.merchantId,
    qualityScore: deal.qualityScore,
    contentEligibility: deal.contentEligibility,
    freshnessStatus: deal.freshnessStatus,
    dealCategory: deal.dealCategory,
    isBogo: deal.isBogo,
    isFreeItem: deal.isFreeItem,
    recurring: deal.recurring,
    submissionSource: deal.submissionSource,
    lastFeedPostedDate: deal.lastFeedPostedDate,
    validDaysOfWeek: deal.validDaysOfWeek,
  }));

  const queue = buildWeeklyContentQueue(queueable, today);
  const weekMonday = mondayOfWeek(referenceDate);

  const slotDealIds: Record<WeeklySlot, string[]> = {
    monday_top5: queue.mondayTop5.map((d) => d.id),
    tuesday_deal: queue.tuesdayDeal ? [queue.tuesdayDeal.id] : [],
    wednesday_local: queue.wednesdayLocal ? [queue.wednesdayLocal.id] : [],
    friday_weekend: queue.fridayWeekend ? [queue.fridayWeekend.id] : [],
    sunday_roundup: queue.sundayRoundup.map((d) => d.id),
  };

  const results: ContentQueueResult[] = [];

  for (const slot of WEEKLY_SLOTS) {
    const dealIds = slotDealIds[slot];
    if (dealIds.length === 0) continue;

    const scheduledDate = new Date(weekMonday);
    scheduledDate.setUTCDate(scheduledDate.getUTCDate() + SLOT_DAY_OFFSET[slot]);
    const scheduledDateStr = scheduledDate.toISOString().slice(0, 10);

    const [existingPost] = await db
      .select()
      .from(dealContentPosts)
      .where(
        and(
          eq(dealContentPosts.universityId, universityId),
          eq(dealContentPosts.slot, slot),
          eq(dealContentPosts.scheduledDate, scheduledDateStr),
        ),
      )
      .limit(1);

    if (existingPost && ["approved", "scheduled", "published"].includes(existingPost.status)) {
      results.push({
        postId: existingPost.id,
        slot,
        scheduledDate: scheduledDateStr,
        dealCount: dealIds.length,
        status: `${existingPost.status} (locked, not rebuilt)`,
      });
      continue;
    }

    let postId: string;
    if (existingPost) {
      postId = existingPost.id;
      await db
        .update(dealContentPosts)
        .set({ status: "ready_for_approval", updatedAt: new Date() })
        .where(eq(dealContentPosts.id, postId));
      await db.delete(dealContentPostDeals).where(eq(dealContentPostDeals.postId, postId));
    } else {
      const [created] = await db
        .insert(dealContentPosts)
        .values({
          universityId,
          slot,
          scheduledDate: scheduledDateStr,
          title: SLOT_TITLES[slot],
          status: "ready_for_approval",
        })
        .returning();
      if (!created) throw new Error("Failed to create deal content post");
      postId = created.id;
    }

    for (let i = 0; i < dealIds.length; i++) {
      await db.insert(dealContentPostDeals).values({ postId, dealId: dealIds[i]!, position: i });
    }

    // Record usage so the feed repeat-suppression window (spec Phase 8) and
    // performance-learning history (spec Phase 14) both see this cycle.
    await db
      .update(deals)
      .set({ lastFeedPostedDate: scheduledDateStr, timesUsed: sql`${deals.timesUsed} + 1`, lastContentFormat: slot })
      .where(inArray(deals.id, dealIds));

    results.push({ postId, slot, scheduledDate: scheduledDateStr, dealCount: dealIds.length, status: "ready_for_approval" });
  }

  return results;
}
