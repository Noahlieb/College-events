/**
 * Coverage metrics.
 *
 * The honest framing matters here, so it is stated in the types: this
 * measures **observable** coverage, not coverage of the internet. Nothing
 * can know how many events happened near a campus last Thursday. What can
 * be known is how much of the ecosystem we set out to find has been found,
 * how much of what we found is still answering, and — the useful one —
 * how often something *else* found an event our own sources missed.
 *
 * That last number is the point of the whole discovery subsystem. A source
 * registry cannot tell you what it is blind to; only a second, independent
 * look can. So the discovery miss rate is treated as the headline metric,
 * and misses are meant to become source candidates rather than a statistic
 * someone looks at once.
 */

export interface CoverageInput {
  /** Coverage categories the taxonomy says a university should have. */
  expectedCategories: string[];
  /** Categories with at least one enabled source. */
  coveredCategories: string[];

  organizationsDiscovered: number;
  organizationsWithSource: number;

  venuesDiscovered: number;
  venuesMonitored: number;

  sourcesTotal: number;
  sourcesHealthy: number;
  sourcesDegraded: number;
  sourcesFailed: number;
  /** Sources whose fingerprinted platform we cannot crawl at all — a gap
   * on our side, distinct from a source that is unhealthy. */
  unsupportedPlatformsDetected: number;

  /** Events found in the last 7 days — a short, legible freshness signal,
   * separate from the wider window the flyer-rate metric uses. */
  eventsLast7Days: number;

  /** Events seen in the flyer-rate reporting window. */
  eventsTotal: number;
  /** Events whose chosen artwork is real (not generated). */
  eventsWithOfficialFlyer: number;
  /** Events currently rendering generated artwork. */
  eventsWithGeneratedArtwork: number;

  /** Events an independent discovery pass found. */
  discoveryProbeEvents: number;
  /** Of those, the ones no registered source had reported. */
  discoveryProbeMisses: number;
}

export interface CoverageMetric {
  key: string;
  label: string;
  value: number;
  /** Present when the metric is a ratio; `value` is then the numerator. */
  outOf?: number;
  /** 0..1 for ratios; null when there is nothing to divide by. */
  ratio: number | null;
  /** What a reader should do about it, when the number is bad. */
  note?: string;
}

export interface CoverageReport {
  metrics: CoverageMetric[];
  /** Categories with no enabled source — what to go and find next. */
  gaps: string[];
  /** 0..1 headline health, or null when there is not enough data. */
  discoveryMissRate: number | null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function computeCoverage(input: CoverageInput): CoverageReport {
  const covered = new Set(input.coveredCategories);
  const gaps = input.expectedCategories.filter((c) => !covered.has(c));

  const missRate = ratio(input.discoveryProbeMisses, input.discoveryProbeEvents);

  const metrics: CoverageMetric[] = [
    {
      key: "active_sources",
      label: "Active sources",
      value: input.sourcesTotal,
      ratio: null, // a raw count, not a fraction of anything
    },
    {
      key: "unsupported_platforms",
      label: "Detected platforms we cannot crawl",
      value: input.unsupportedPlatformsDetected,
      ratio: null,
      note:
        input.unsupportedPlatformsDetected > 0
          ? "Fingerprinted, but no adapter exists yet — a gap on our side, not a broken source."
          : undefined,
    },
    {
      key: "events_last_7_days",
      label: "Events found, last 7 days",
      value: input.eventsLast7Days,
      ratio: null,
    },
    {
      key: "category_coverage",
      label: "Expected source categories covered",
      value: input.expectedCategories.length - gaps.length,
      outOf: input.expectedCategories.length,
      ratio: ratio(input.expectedCategories.length - gaps.length, input.expectedCategories.length),
      note: gaps.length > 0 ? `Missing: ${gaps.join(", ")}` : undefined,
    },
    {
      key: "organizations_with_source",
      label: "Student organizations with an event source",
      value: input.organizationsWithSource,
      outOf: input.organizationsDiscovered,
      ratio: ratio(input.organizationsWithSource, input.organizationsDiscovered),
      note:
        input.organizationsDiscovered > 0 && input.organizationsWithSource === 0
          ? "Organizations are known but none has a feed — their events can only arrive second-hand."
          : undefined,
    },
    {
      key: "venues_monitored",
      label: "Local venues actively monitored",
      value: input.venuesMonitored,
      outOf: input.venuesDiscovered,
      ratio: ratio(input.venuesMonitored, input.venuesDiscovered),
    },
    {
      key: "sources_healthy",
      label: "Sources currently healthy",
      value: input.sourcesHealthy,
      outOf: input.sourcesTotal,
      ratio: ratio(input.sourcesHealthy, input.sourcesTotal),
      note:
        input.sourcesDegraded > 0
          ? `${input.sourcesDegraded} degraded — the platform declined automated access, which is not a defect. Other sources need to cover those events.`
          : undefined,
    },
    {
      key: "official_flyer_rate",
      label: "Events showing a real flyer",
      value: input.eventsWithOfficialFlyer,
      outOf: input.eventsTotal,
      ratio: ratio(input.eventsWithOfficialFlyer, input.eventsTotal),
      note:
        input.eventsTotal > 0 && input.eventsWithOfficialFlyer / input.eventsTotal < 0.5
          ? "Most events are rendering generated art. Usually means the sources reporting them are listings rather than the organizers' own pages."
          : undefined,
    },
    {
      key: "generated_artwork_rate",
      label: "Events using generated artwork",
      value: input.eventsWithGeneratedArtwork,
      outOf: input.eventsTotal,
      ratio: ratio(input.eventsWithGeneratedArtwork, input.eventsTotal),
    },
    {
      key: "discovery_miss_rate",
      label: "Events found by discovery that our sources missed",
      value: input.discoveryProbeMisses,
      outOf: input.discoveryProbeEvents,
      ratio: missRate,
      note:
        missRate === null
          ? "No discovery probe has run — this university's blind spots are unmeasured."
          : missRate > 0.2
            ? "A fifth or more of sampled events came from nowhere we monitor. Review the source candidates these misses generated."
            : undefined,
    },
  ];

  return { metrics, gaps, discoveryMissRate: missRate };
}

/**
 * A single 0..1 score, for sorting universities on an index page.
 *
 * Deliberately not shown as a headline number anywhere: it averages things
 * that are not really commensurable, and a single score invites treating
 * "83% covered" as a fact about the world rather than about our own
 * registry. It exists to answer "which university needs attention first".
 */
export function coverageScore(report: CoverageReport): number | null {
  const weights: Record<string, number> = {
    category_coverage: 0.3,
    organizations_with_source: 0.15,
    venues_monitored: 0.15,
    sources_healthy: 0.2,
    official_flyer_rate: 0.1,
  };

  let total = 0;
  let weightUsed = 0;
  for (const metric of report.metrics) {
    const weight = weights[metric.key];
    if (weight === undefined || metric.ratio === null) continue;
    total += metric.ratio * weight;
    weightUsed += weight;
  }

  // Misses count against the score rather than for it.
  if (report.discoveryMissRate !== null) {
    total += (1 - report.discoveryMissRate) * 0.1;
    weightUsed += 0.1;
  }

  return weightUsed > 0 ? total / weightUsed : null;
}
