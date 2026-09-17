import { describe, expect, it } from "vitest";
import { buildWeeklyContentQueue, type QueueableDeal } from "./deal-content-queue.js";

const today = "2026-09-17"; // Thursday

function deal(overrides: Partial<QueueableDeal> & { id: string }): QueueableDeal {
  return {
    merchantId: overrides.id,
    qualityScore: 70,
    contentEligibility: "feed_worthy",
    freshnessStatus: "new",
    dealCategory: "food_restaurant",
    isBogo: false,
    isFreeItem: false,
    recurring: false,
    submissionSource: "scraped",
    validDaysOfWeek: [],
    ...overrides,
  };
}

describe("buildWeeklyContentQueue", () => {
  it("fills Monday's top 5 from the highest-scoring eligible deals, one per merchant", () => {
    const deals = Array.from({ length: 8 }, (_, i) => deal({ id: `d${i}`, qualityScore: 90 - i }));
    const queue = buildWeeklyContentQueue(deals, today);
    expect(queue.mondayTop5).toHaveLength(5);
    expect(new Set(queue.mondayTop5.map((d) => d.merchantId)).size).toBe(5);
    // highest scores picked first
    expect(queue.mondayTop5[0]!.id).toBe("d0");
  });

  it("prefers a Tuesday-valid deal for the Tuesday slot even when Monday's top 5 outranks it", () => {
    const fillers = [80, 79, 78, 77].map((score, i) => deal({ id: `filler${i}`, qualityScore: score }));
    const deals = [
      deal({ id: "not-tuesday", qualityScore: 95, validDaysOfWeek: [3] }),
      ...fillers,
      deal({ id: "tuesday-special", qualityScore: 60, validDaysOfWeek: [2] }),
    ];
    const queue = buildWeeklyContentQueue(deals, today);
    expect(queue.mondayTop5.map((d) => d.id)).not.toContain("tuesday-special");
    expect(queue.tuesdayDeal?.id).toBe("tuesday-special");
  });

  it("excludes deals whose fingerprint was used in the feed within the suppression window", () => {
    const recentlyUsed = deal({ id: "recent", qualityScore: 99, lastFeedPostedDate: "2026-09-10" });
    const fresh = deal({ id: "fresh", qualityScore: 50 });
    const queue = buildWeeklyContentQueue([recentlyUsed, fresh], today);
    const allIds = [
      ...queue.mondayTop5,
      queue.tuesdayDeal,
      queue.wednesdayLocal,
      queue.fridayWeekend,
      ...queue.sundayRoundup,
    ]
      .filter((d): d is QueueableDeal => !!d)
      .map((d) => d.id);
    expect(allIds).not.toContain("recent");
    expect(allIds).toContain("fresh");
  });

  it("allows a deal outside the suppression window back into the feed", () => {
    const longAgo = deal({ id: "long-ago", qualityScore: 99, lastFeedPostedDate: "2026-06-01" });
    const queue = buildWeeklyContentQueue([longAgo], today);
    expect(queue.mondayTop5.map((d) => d.id)).toContain("long-ago");
  });

  it("excludes reject-tier deals from every slot but keeps story_worthy ones available for Stories", () => {
    const rejected = deal({ id: "rejected", contentEligibility: "reject", qualityScore: 10 });
    const storyOnly = deal({ id: "story-only", contentEligibility: "story_worthy", qualityScore: 55 });
    const queue = buildWeeklyContentQueue([rejected, storyOnly], today);
    expect(queue.stories.map((d) => d.id)).toContain("story-only");
    expect(queue.stories.map((d) => d.id)).not.toContain("rejected");
    expect(queue.mondayTop5.map((d) => d.id)).not.toContain("story-only");
  });
});
