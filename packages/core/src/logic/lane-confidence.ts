export type LaneConfidenceLevel = "high" | "medium" | "low" | "unknown";

/** One past operator edit, as recorded in lane_selections. `lane` is the
 * lane the operator chose, or null when the edit cleared a pin back to
 * auto-routing — that's a real, countable outcome ("this venue's events
 * shouldn't be pinned at all"), not the absence of one. */
export interface LaneSelectionHistoryEntry {
  venue: string | null;
  sourceName: string | null;
  category: string;
  lane: string | null;
}

export interface LaneConfidenceResult {
  level: LaneConfidenceLevel;
  /** Plain-English basis for the review UI's tooltip. */
  reason: string;
}

const NO_LANE_KEY = "__none__";

/**
 * How much an operator's past corrections back up `resolvedLane` — the
 * lane auto-routing (or a current manual pin) has landed this event on —
 * for the review UI's confidence indicator (recommendation §4).
 *
 * Two similarity tiers, most specific first:
 *   1. Exact venue match — the strongest signal; the same room's events
 *      tend to belong in the same lane every time.
 *   2. Same source + category, when no venue history exists — weaker
 *      (one source can cover many different venues) but still better
 *      than nothing.
 * A venue match is preferred outright over a source/category match even
 * when both exist, rather than blending them, because a handful of exact
 * hits at the same venue says more than a larger but noisier source-wide
 * sample.
 *
 * "Unknown" (no opinion) is the default for anything with zero matching
 * history — this table only starts accumulating rows going forward, so
 * every event is "unknown" until enough corrections land for its venue or
 * source/category to say something.
 */
export function laneConfidence(
  event: { venue: string | null; sourceName: string | null; category: string; resolvedLane: string | null },
  history: readonly LaneSelectionHistoryEntry[],
): LaneConfidenceResult {
  const normalizedVenue = event.venue?.trim().toLowerCase() || null;
  const byVenue = normalizedVenue ? history.filter((h) => h.venue?.trim().toLowerCase() === normalizedVenue) : [];

  const bySourceCategory =
    byVenue.length === 0 ? history.filter((h) => h.sourceName === event.sourceName && h.category === event.category) : [];

  const pool = byVenue.length > 0 ? byVenue : bySourceCategory;
  if (pool.length === 0) {
    return { level: "unknown", reason: "No selection history yet for this venue or source/category." };
  }
  const basis = byVenue.length > 0 ? "this venue" : "this source and category";

  const counts = new Map<string, number>();
  for (const h of pool) {
    const key = h.lane ?? NO_LANE_KEY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = pool.length;
  const [topLane, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const resolvedKey = event.resolvedLane ?? NO_LANE_KEY;
  const laneWord = (key: string) => (key === NO_LANE_KEY ? "no post" : key);

  if (topLane !== resolvedKey) {
    return {
      level: "low",
      reason: `${topCount}/${total} past picks for ${basis} went to ${laneWord(topLane)}, not the current lane.`,
    };
  }

  const ratio = topCount / total;
  if (total >= 2 && ratio >= 0.8) {
    return { level: "high", reason: `${topCount}/${total} past picks for ${basis} agree with this lane.` };
  }
  return { level: "medium", reason: `${topCount}/${total} past picks for ${basis} agree with this lane.` };
}
