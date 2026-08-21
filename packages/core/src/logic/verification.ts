import type { VerificationStatus } from "../types/enums.js";

export interface SourceObservation {
  sourceId: string;
  /** 1 (low trust, e.g. generic webpage) - 10 (high trust, e.g. official athletics site) */
  sourcePriority: number;
  startAt: string; // ISO
}

const RELIABLE_PRIORITY_THRESHOLD = 6;
const CONFLICT_WINDOW_HOURS = 0.5;

/**
 * Determine verification status from the set of source observations that
 * were merged into one event (spec §16). Never guesses a resolved time when
 * sources disagree — that always becomes CONFLICT for human review.
 */
export function computeVerificationStatus(observations: SourceObservation[]): {
  status: VerificationStatus;
  reason: string;
} {
  if (observations.length === 0) {
    return { status: "needs_review", reason: "no source observations" };
  }

  const reliable = observations.filter((o) => o.sourcePriority >= RELIABLE_PRIORITY_THRESHOLD);

  const startTimes = observations.map((o) => new Date(o.startAt).getTime());
  const spreadHours = (Math.max(...startTimes) - Math.min(...startTimes)) / 36e5;
  if (observations.length > 1 && spreadHours > CONFLICT_WINDOW_HOURS) {
    return {
      status: "conflict",
      reason: `sources disagree on start time by ${spreadHours.toFixed(1)}h`,
    };
  }

  if (reliable.length >= 2) {
    return { status: "verified", reason: `${reliable.length} reliable sources agree` };
  }
  if (reliable.length === 1 || observations.length >= 2) {
    return { status: "high_confidence", reason: "single reliable source or multiple corroborating sources" };
  }
  return { status: "needs_review", reason: "single low-priority source only" };
}
