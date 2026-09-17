import type { ContentEligibility, DealCategory, FreshnessStatus, SubmissionSourceType } from "../types/deals-enums.js";

export interface QueueableDeal {
  id: string;
  merchantId: string;
  qualityScore: number;
  contentEligibility: ContentEligibility;
  freshnessStatus: FreshnessStatus;
  dealCategory: DealCategory;
  isBogo: boolean;
  isFreeItem: boolean;
  recurring: boolean;
  submissionSource: SubmissionSourceType;
  lastFeedPostedDate?: string | null;
  validDaysOfWeek: number[];
}

export interface WeeklyContentQueue {
  mondayTop5: QueueableDeal[];
  tuesdayDeal?: QueueableDeal;
  wednesdayLocal?: QueueableDeal;
  fridayWeekend?: QueueableDeal;
  sundayRoundup: QueueableDeal[];
  stories: QueueableDeal[];
}

const WEEKEND_DAYS = new Set([5, 6, 0]); // Fri, Sat, Sun

/** Spec Phase 8: "do not use the exact same recurring deal as a standalone
 * feed post more often than every 4-6 weeks." 4 weeks is the floor. */
const FEED_REPEAT_SUPPRESSION_WEEKS = 4;

function daysSince(dateIso: string, today: string): number {
  return Math.round((new Date(today).getTime() - new Date(dateIso).getTime()) / 86_400_000);
}

function recentlyUsedInFeed(deal: QueueableDeal, today: string, suppressionWeeks: number): boolean {
  if (!deal.lastFeedPostedDate) return false;
  return daysSince(deal.lastFeedPostedDate, today) < suppressionWeeks * 7;
}

/** Picks up to `count` deals, capping one per merchant first so a single
 * business can't dominate a slot (spec Phase 8: "a merchant should
 * generally not dominate the feed"), then backfills from the same pool if
 * the diverse pass didn't reach `count`. */
function pickDiverse(pool: QueueableDeal[], count: number): QueueableDeal[] {
  const picked: QueueableDeal[] = [];
  const seenMerchants = new Set<string>();

  for (const deal of pool) {
    if (picked.length >= count) break;
    if (seenMerchants.has(deal.merchantId)) continue;
    picked.push(deal);
    seenMerchants.add(deal.merchantId);
  }
  if (picked.length < count) {
    for (const deal of pool) {
      if (picked.length >= count) break;
      if (picked.includes(deal)) continue;
      picked.push(deal);
    }
  }
  return picked;
}

/**
 * Builds the proposed weekly content queue (spec Phase 9): Monday top 5,
 * Tuesday single deal, Wednesday local deal of the week, Friday weekend
 * deal, Sunday curated roundup, plus a broader Stories pool. Pure selection
 * logic — callers persist the result as content_posts/content_post_deals
 * rows and route it through the human approval queue; nothing here
 * publishes anything.
 */
export function buildWeeklyContentQueue(
  deals: QueueableDeal[],
  today: string,
  suppressionWeeks: number = FEED_REPEAT_SUPPRESSION_WEEKS,
): WeeklyContentQueue {
  const feedPool = deals
    .filter((d) => d.contentEligibility === "feed_worthy" && !recentlyUsedInFeed(d, today, suppressionWeeks))
    .sort((a, b) => b.qualityScore - a.qualityScore);

  const used = new Set<string>();
  const take = (predicate?: (d: QueueableDeal) => boolean): QueueableDeal | undefined => {
    const candidates = feedPool.filter((d) => !used.has(d.id) && (!predicate || predicate(d)));
    const pick = candidates[0];
    if (pick) used.add(pick.id);
    return pick;
  };

  const mondayTop5 = pickDiverse(
    feedPool.filter((d) => !used.has(d.id)),
    5,
  );
  for (const d of mondayTop5) used.add(d.id);

  // Tuesday favors a deal that's actually valid on Tuesday (Taco Tuesday-shaped).
  const tuesdayDeal = take((d) => d.validDaysOfWeek.includes(2)) ?? take();

  // Wednesday: best remaining local (non-chain/sponsored) deal.
  const wednesdayLocal =
    take((d) => d.submissionSource !== "sponsored" && d.submissionSource !== "exclusive") ?? take();

  // Friday favors weekend-valid or urgently-expiring deals.
  const fridayWeekend =
    take((d) => d.validDaysOfWeek.some((day) => WEEKEND_DAYS.has(day)) || d.freshnessStatus === "expiring_soon") ??
    take();

  const sundayRoundup: QueueableDeal[] = [];
  while (sundayRoundup.length < 3) {
    const pick = take();
    if (!pick) break;
    sundayRoundup.push(pick);
  }

  // Stories draw from the broader eligible pool (feed_worthy + story_worthy),
  // reusing recurring deals more freely than the feed per spec Phase 10.
  const storyPool = deals
    .filter((d) => (d.contentEligibility === "feed_worthy" || d.contentEligibility === "story_worthy") && !used.has(d.id))
    .sort((a, b) => b.qualityScore - a.qualityScore);
  const stories = storyPool.slice(0, 10);

  return { mondayTop5, tuesdayDeal, wednesdayLocal, fridayWeekend, sundayRoundup, stories };
}
