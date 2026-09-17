import type { ContentEligibility } from "../types/deals-enums.js";

export interface EligibilityThresholds {
  /** >= this score, and not evergreen: feed_worthy, ranked as priority feed. */
  feedPriorityMin: number;
  /** >= this score: still feed_worthy (a "feed candidate", spec Phase 8). */
  feedCandidateMin: number;
  /** >= this score: story_worthy / roundup candidate. Below it: reject. */
  storyWorthyMin: number;
}

export const DEFAULT_ELIGIBILITY_THRESHOLDS: EligibilityThresholds = {
  feedPriorityMin: 80,
  feedCandidateMin: 65,
  storyWorthyMin: 50,
};

/**
 * Separates a scored deal into FEED-WORTHY / STORY-WORTHY / EVERGREEN
 * LIBRARY / REJECT (spec Phase 8). Evergreen deals are routed to the
 * library regardless of score once they clear the story-worthy floor —
 * they're valuable but must not dominate the feed as repeated standalone
 * posts, so they wait for a roundup/editorial slot instead.
 */
export function classifyContentEligibility(
  qualityScore: number,
  isEvergreen: boolean,
  thresholds: EligibilityThresholds = DEFAULT_ELIGIBILITY_THRESHOLDS,
): ContentEligibility {
  if (qualityScore < thresholds.storyWorthyMin) return "reject";
  if (isEvergreen) return "evergreen_library";
  if (qualityScore >= thresholds.feedCandidateMin) return "feed_worthy";
  return "story_worthy";
}
