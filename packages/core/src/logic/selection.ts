import type { EventCategory, VerificationStatus } from "../types/enums.js";
import type { BucketScores } from "../types/domain.js";

export type PostBucket = keyof Omit<BucketScores, "overall">;

export interface SelectableEvent {
  id: string;
  category: EventCategory;
  bucketScores: BucketScores;
  verificationStatus: VerificationStatus;
  startAt: string;
}

export interface SelectionOptions {
  bucket: PostBucket;
  maxSlides: number;
  /** Events scoring below this in the target bucket are never included,
   * even if that means shipping fewer slides than maxSlides (spec §20). */
  minScore?: number;
  /** REJECTED/CONFLICT events are always excluded regardless of score. */
  now?: Date;
}

const DEFAULT_MIN_SCORE = 55;

/**
 * Rank and select events for a weekly post bucket. Quality over quantity:
 * never pads with weak events just to fill slides, and always excludes
 * CONFLICT/REJECTED events (those need human resolution first).
 */
export function selectEventsForPost(
  events: SelectableEvent[],
  options: SelectionOptions,
): SelectableEvent[] {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const now = options.now ?? new Date();

  const eligible = events.filter((e) => {
    if (e.verificationStatus === "conflict" || e.verificationStatus === "rejected") return false;
    if (new Date(e.startAt).getTime() < now.getTime()) return false;
    return e.bucketScores[options.bucket] >= minScore;
  });

  const ranked = [...eligible].sort((a, b) => {
    const scoreDiff = b.bucketScores[options.bucket] - a.bucketScores[options.bucket];
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  });

  const selected = dedupeByCategoryCap(ranked, options.bucket).slice(0, options.maxSlides);
  return selected;
}

/**
 * Soft cap so one category (e.g. five nearly-identical happy hours) can't
 * dominate every slide; allows at most ~60% of slides from a single category
 * once there are enough other eligible events to diversify with.
 */
function dedupeByCategoryCap(ranked: SelectableEvent[], bucket: PostBucket): SelectableEvent[] {
  if (ranked.length <= 2) return ranked;
  const maxPerCategory = Math.max(2, Math.ceil(ranked.length * 0.6));
  const counts = new Map<EventCategory, number>();
  const out: SelectableEvent[] = [];
  const overflow: SelectableEvent[] = [];

  for (const event of ranked) {
    const count = counts.get(event.category) ?? 0;
    if (count < maxPerCategory) {
      out.push(event);
      counts.set(event.category, count + 1);
    } else {
      overflow.push(event);
    }
  }
  return [...out, ...overflow];
}
