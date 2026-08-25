import type { SourceHealthStatus } from "../types/enums.js";

/**
 * Source health as a state machine, kept out of the crawler so the rules
 * are testable on their own and identical wherever they are applied.
 *
 * The distinction that matters most here is DEGRADED vs FAILED. A platform
 * declining automated access — an anti-bot challenge, a 403, a login wall
 * — is its access control working, not a defect in our code. Calling that
 * FAILED would put a permanent red mark on a source nobody can fix, and
 * would invite the wrong response (retry harder, look for a way around).
 * DEGRADED says: back off, leave it configured, let other sources cover
 * these events.
 */

/** How many consecutive errors before a source is considered FAILED. */
export const FAILURE_THRESHOLD = 3;

/** Back-off floor applied to a source that declined automated access. */
export const DEGRADED_MIN_BACKOFF_MINUTES = 720;

export interface SourceRunObservation {
  /** Items the adapter returned this run (new or already-seen). */
  itemsSeen: number;
  /** Items that were new to us. */
  discovered: number;
  /** Whether this source has ever produced an event before. */
  hasYieldedBefore: boolean;
  /** Consecutive errors including this run; 0 when this run succeeded. */
  consecutiveFailures: number;
  /** Set when the run ended in an error. */
  error?: { kind: "access_denied" | "error"; message: string };
}

export interface SourceHealthVerdict {
  status: SourceHealthStatus;
  reason?: string;
}

/**
 * The health a source should be left in after one run.
 *
 * The subtle case is the silent source: it answers, it does not error, and
 * it returns nothing. That is the failure mode that quietly shrinks
 * coverage — every run looks clean while the calendar empties. A source
 * with a history of yielding events that suddenly returns none is
 * therefore WARNING, while one that has never yielded is left alone (an
 * out-of-season athletics feed is legitimately empty).
 */
export function evaluateSourceHealth(obs: SourceRunObservation): SourceHealthVerdict {
  if (obs.error) {
    if (obs.error.kind === "access_denied") {
      return { status: "degraded", reason: obs.error.message };
    }
    return {
      status: obs.consecutiveFailures >= FAILURE_THRESHOLD ? "failed" : "warning",
      reason: obs.error.message,
    };
  }

  if (obs.itemsSeen > 0) return { status: "healthy" };

  if (obs.hasYieldedBefore) {
    return {
      status: "warning",
      reason: "responded but returned no events, and this source has produced events before",
    };
  }

  return { status: "healthy" };
}

/**
 * When to next crawl a source. A degraded source waits at least
 * DEGRADED_MIN_BACKOFF_MINUTES regardless of its configured interval:
 * re-requesting into an active challenge every few minutes is wasted work
 * and is exactly the behaviour such a control exists to stop.
 */
export function nextRunAfter(
  now: Date,
  crawlIntervalMinutes: number,
  status: SourceHealthStatus,
): Date {
  const minutes =
    status === "degraded"
      ? Math.max(crawlIntervalMinutes, DEGRADED_MIN_BACKOFF_MINUTES)
      : crawlIntervalMinutes;
  return new Date(now.getTime() + minutes * 60_000);
}

/** Whether a health state should keep a source out of the crawl queue. */
export function isCrawlable(status: SourceHealthStatus): boolean {
  return status !== "disabled";
}
