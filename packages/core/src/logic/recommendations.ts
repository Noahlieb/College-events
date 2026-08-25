/**
 * Turning observable gaps into a prioritized to-do list.
 *
 * Coverage metrics say a university's source graph is incomplete;
 * recommendations say what to do about it. Everything here is derived
 * from data the system already has — a fingerprinted candidate nobody
 * approved yet, a domain that keeps producing discovery misses, an
 * organization with no way to hear from it — never invented, and nothing
 * here creates or enables anything on its own. The objective is a source
 * graph that gets more complete over time, one reviewed decision at a
 * time.
 */

export type RecommendationPriority = "high" | "medium" | "low";

export interface SourceRecommendation {
  priority: RecommendationPriority;
  title: string;
  reason: string;
  /** What this recommendation is about, for linking from the UI. */
  kind: "pending_candidate" | "discovery_miss_origin" | "coverage_gap" | "unlinked_organizations";
  /** Candidate/domain id the dashboard should deep-link to, when there is one. */
  targetId?: string;
}

export interface PendingCandidateSummary {
  id: string;
  name: string;
  coverageCategory: string | null;
  confidence: number;
  detectedAdapter: string | null;
}

export interface MissOriginSummary {
  domain: string;
  count: number;
  hasCandidate: boolean;
  candidateId?: string;
  /** A representative event title, for a readable recommendation. */
  sampleTitle?: string;
}

export interface RecommendationInput {
  /** Expected coverage categories with no enabled source. */
  gaps: string[];
  /** Human labels for gap categories, for readable titles. */
  categoryLabels: Record<string, string>;
  pendingCandidates: PendingCandidateSummary[];
  missOrigins: MissOriginSummary[];
  unlinkedOrganizationCount: number;
}

/** Confidence above which a candidate is worth calling out by name. */
const NOTABLE_CONFIDENCE = 0.85;
/** Repeated misses from one place before it is worth a recommendation.
 * One or two could be noise in the matching; three is a pattern. */
const MISS_RECOMMENDATION_THRESHOLD = 3;

export function buildSourceRecommendations(input: RecommendationInput): SourceRecommendation[] {
  const out: SourceRecommendation[] = [];
  const gapSet = new Set(input.gaps);
  const filledByCandidate = new Set<string>();

  // A confident, already-fingerprinted candidate sitting in an expected,
  // uncovered category is the cheapest win there is — someone just has to
  // click approve.
  for (const candidate of input.pendingCandidates) {
    if (!candidate.coverageCategory || !gapSet.has(candidate.coverageCategory)) continue;
    if (candidate.confidence < NOTABLE_CONFIDENCE) continue;
    if (!candidate.detectedAdapter || candidate.detectedAdapter === "generic_web") continue;

    out.push({
      priority: "high",
      kind: "pending_candidate",
      title: `Add ${candidate.name}`,
      reason: `${input.categoryLabels[candidate.coverageCategory] ?? candidate.coverageCategory} detected but not monitored.`,
      targetId: candidate.id,
    });
    filledByCandidate.add(candidate.coverageCategory);
  }

  // A domain that keeps turning up in discovery misses is telling us
  // something a one-off search result cannot: this is a real, recurring
  // producer we have no source for.
  for (const origin of input.missOrigins) {
    if (origin.hasCandidate || origin.count < MISS_RECOMMENDATION_THRESHOLD) continue;
    out.push({
      priority: "high",
      kind: "discovery_miss_origin",
      title: `Add ${origin.sampleTitle ? originLabel(origin.sampleTitle) : origin.domain}`,
      reason: `${origin.count} discovery misses originated from ${origin.domain}.`,
      targetId: origin.candidateId,
    });
  }

  // Everything else still missing gets a lower-urgency nudge to run
  // discovery again or look by hand — there is nothing to click yet.
  for (const gap of input.gaps) {
    if (filledByCandidate.has(gap)) continue;
    out.push({
      priority: "medium",
      kind: "coverage_gap",
      title: `Find a ${input.categoryLabels[gap] ?? gap} source`,
      reason: "No candidate has been found for this expected category yet.",
    });
  }

  if (input.unlinkedOrganizationCount > 0) {
    out.push({
      priority: "medium",
      kind: "unlinked_organizations",
      title: `Add ${input.unlinkedOrganizationCount} student organization event channel${input.unlinkedOrganizationCount === 1 ? "" : "s"}`,
      reason: "These organizations are known but have no way to report their events.",
    });
  }

  const rank: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

/** A venue name guessed from an event title, e.g. "College Night @ The Vanguard" → "The Vanguard". */
function originLabel(sampleTitle: string): string {
  const at = /(?:@|at)\s+([A-Z][\w' -]{2,40})$/.exec(sampleTitle);
  return at ? at[1]!.trim() : sampleTitle;
}
