import { describe, expect, it } from "vitest";
import { computeCoverage, coverageScore, type CoverageInput } from "./coverage.js";

const input = (overrides: Partial<CoverageInput> = {}): CoverageInput => ({
  expectedCategories: ["athletics", "student_government", "nightclubs"],
  coveredCategories: ["athletics"],
  organizationsDiscovered: 10,
  organizationsWithSource: 4,
  venuesDiscovered: 8,
  venuesMonitored: 3,
  sourcesTotal: 12,
  sourcesHealthy: 9,
  sourcesDegraded: 1,
  sourcesFailed: 2,
  unsupportedPlatformsDetected: 0,
  eventsLast7Days: 20,
  eventsTotal: 100,
  eventsWithOfficialFlyer: 70,
  eventsWithGeneratedArtwork: 15,
  discoveryProbeEvents: 50,
  discoveryProbeMisses: 5,
  ...overrides,
});

const metric = (report: ReturnType<typeof computeCoverage>, key: string) =>
  report.metrics.find((m) => m.key === key)!;

describe("computeCoverage", () => {
  it("names the categories with no source as gaps", () => {
    // The actionable output: not "67% covered" but "you have no student
    // government and no nightlife source".
    const report = computeCoverage(input());
    expect(report.gaps).toEqual(["student_government", "nightclubs"]);
  });

  it("reports ratios against their own denominator", () => {
    const report = computeCoverage(input());
    expect(metric(report, "sources_healthy").ratio).toBeCloseTo(9 / 12);
    expect(metric(report, "official_flyer_rate").ratio).toBeCloseTo(0.7);
  });

  it("returns null rather than zero when there is nothing to divide by", () => {
    // A brand-new university has no events. Reporting "0% flyer coverage"
    // would read as a failure rather than as an absence of data.
    const report = computeCoverage(input({ eventsTotal: 0, eventsWithOfficialFlyer: 0 }));
    expect(metric(report, "official_flyer_rate").ratio).toBeNull();
  });
});

describe("discovery miss rate — the headline metric", () => {
  it("measures what our own sources were blind to", () => {
    const report = computeCoverage(input({ discoveryProbeEvents: 40, discoveryProbeMisses: 10 }));
    expect(report.discoveryMissRate).toBeCloseTo(0.25);
  });

  it("is null, not zero, when no probe has run", () => {
    // Claiming a 0% miss rate because nobody looked is exactly the false
    // confidence this metric exists to prevent.
    const report = computeCoverage(input({ discoveryProbeEvents: 0, discoveryProbeMisses: 0 }));
    expect(report.discoveryMissRate).toBeNull();
    expect(metric(report, "discovery_miss_rate").note).toMatch(/unmeasured/i);
  });

  it("tells the reader what to do when the rate is high", () => {
    const report = computeCoverage(input({ discoveryProbeEvents: 40, discoveryProbeMisses: 20 }));
    expect(metric(report, "discovery_miss_rate").note).toMatch(/source candidates/i);
  });

  it("stays quiet when the rate is low", () => {
    const report = computeCoverage(input({ discoveryProbeEvents: 100, discoveryProbeMisses: 2 }));
    expect(metric(report, "discovery_miss_rate").note).toBeUndefined();
  });
});

describe("notes explain bad numbers", () => {
  it("explains that degraded is not a defect", () => {
    // Someone reading a red dashboard should not go looking for a bug, or
    // for a way around the platform's access control.
    const note = metric(computeCoverage(input({ sourcesDegraded: 3 })), "sources_healthy").note!;
    expect(note).toMatch(/not a defect/i);
  });

  it("explains a low flyer rate in terms of source type", () => {
    const report = computeCoverage(input({ eventsTotal: 100, eventsWithOfficialFlyer: 10 }));
    expect(metric(report, "official_flyer_rate").note).toMatch(/listings rather than the organizers/i);
  });

  it("flags organizations that are known but unreachable", () => {
    const report = computeCoverage(input({ organizationsDiscovered: 40, organizationsWithSource: 0 }));
    expect(metric(report, "organizations_with_source").note).toMatch(/second-hand/i);
  });
});

describe("coverageScore", () => {
  it("ranks a well-covered university above a poorly-covered one", () => {
    const good = coverageScore(
      computeCoverage(
        input({
          coveredCategories: ["athletics", "student_government", "nightclubs"],
          organizationsWithSource: 9,
          venuesMonitored: 8,
          sourcesHealthy: 12,
          discoveryProbeMisses: 1,
        }),
      ),
    )!;
    const poor = coverageScore(computeCoverage(input({ coveredCategories: [], sourcesHealthy: 2 })))!;
    expect(good).toBeGreaterThan(poor);
  });

  it("counts discovery misses against the score", () => {
    const fewMisses = coverageScore(computeCoverage(input({ discoveryProbeMisses: 1 })))!;
    const manyMisses = coverageScore(computeCoverage(input({ discoveryProbeMisses: 40 })))!;
    expect(fewMisses).toBeGreaterThan(manyMisses);
  });

  it("stays within 0..1", () => {
    for (const probe of [0, 25, 50]) {
      const score = coverageScore(computeCoverage(input({ discoveryProbeMisses: probe })));
      if (score !== null) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is null when nothing measurable exists yet", () => {
    const empty = computeCoverage({
      expectedCategories: [],
      coveredCategories: [],
      organizationsDiscovered: 0,
      organizationsWithSource: 0,
      venuesDiscovered: 0,
      venuesMonitored: 0,
      sourcesTotal: 0,
      sourcesHealthy: 0,
      sourcesDegraded: 0,
      sourcesFailed: 0,
      unsupportedPlatformsDetected: 0,
      eventsLast7Days: 0,
      eventsTotal: 0,
      eventsWithOfficialFlyer: 0,
      eventsWithGeneratedArtwork: 0,
      discoveryProbeEvents: 0,
      discoveryProbeMisses: 0,
    });
    expect(coverageScore(empty)).toBeNull();
  });
});

describe("new observable metrics — active sources, unsupported platforms, generated artwork", () => {
  it("reports active sources as a raw count, not a fraction", () => {
    const m = metric(computeCoverage(input({ sourcesTotal: 7 })), "active_sources");
    expect(m.value).toBe(7);
    expect(m.ratio).toBeNull();
  });

  it("flags detected platforms nobody can crawl as our gap, not the source's", () => {
    const m = metric(computeCoverage(input({ unsupportedPlatformsDetected: 3 })), "unsupported_platforms");
    expect(m.value).toBe(3);
    expect(m.note).toMatch(/gap on our side/i);
  });

  it("stays quiet when every detected platform is supported", () => {
    const m = metric(computeCoverage(input({ unsupportedPlatformsDetected: 0 })), "unsupported_platforms");
    expect(m.note).toBeUndefined();
  });

  it("reports generated-artwork rate against the same denominator as the flyer rate", () => {
    const report = computeCoverage(input({ eventsTotal: 100, eventsWithGeneratedArtwork: 15 }));
    expect(metric(report, "generated_artwork_rate").ratio).toBeCloseTo(0.15);
  });

  it("shows a short 7-day freshness count separate from the wider flyer-rate window", () => {
    const m = metric(computeCoverage(input({ eventsLast7Days: 4, eventsTotal: 100 })), "events_last_7_days");
    expect(m.value).toBe(4);
    expect(m.ratio).toBeNull();
  });
});
