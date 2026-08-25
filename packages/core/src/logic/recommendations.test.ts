import { describe, expect, it } from "vitest";
import { buildSourceRecommendations, type RecommendationInput } from "./recommendations.js";

const base: RecommendationInput = {
  gaps: [],
  categoryLabels: { engagement_portal: "Student engagement portal", athletics: "Athletics" },
  pendingCandidates: [],
  missOrigins: [],
  unlinkedOrganizationCount: 0,
};

describe("buildSourceRecommendations — confident candidates for gaps", () => {
  it("recommends approving a confident, fingerprinted candidate for a missing category", () => {
    const recs = buildSourceRecommendations({
      ...base,
      gaps: ["engagement_portal"],
      pendingCandidates: [
        {
          id: "c1",
          name: "Knight Connect",
          coverageCategory: "engagement_portal",
          confidence: 0.95,
          detectedAdapter: "campuslabs",
        },
      ],
    });
    expect(recs[0]!.priority).toBe("high");
    expect(recs[0]!.title).toBe("Add Knight Connect");
    expect(recs[0]!.reason).toMatch(/detected but not monitored/);
  });

  it("does not recommend a low-confidence candidate by name", () => {
    // Nothing here should read as "just click approve" when the platform
    // guess is genuinely uncertain.
    const recs = buildSourceRecommendations({
      ...base,
      gaps: ["engagement_portal"],
      pendingCandidates: [
        { id: "c1", name: "Maybe Calendar", coverageCategory: "engagement_portal", confidence: 0.4, detectedAdapter: "campuslabs" },
      ],
    });
    expect(recs.some((r) => r.title.includes("Maybe Calendar"))).toBe(false);
    // The gap still surfaces, just as the generic nudge.
    expect(recs.some((r) => r.kind === "coverage_gap")).toBe(true);
  });

  it("ignores an unidentified platform even at high confidence", () => {
    // "Definitely unidentifiable" is not a reason to recommend it by name.
    const recs = buildSourceRecommendations({
      ...base,
      gaps: ["engagement_portal"],
      pendingCandidates: [
        { id: "c1", name: "Some Page", coverageCategory: "engagement_portal", confidence: 0.95, detectedAdapter: "generic_web" },
      ],
    });
    expect(recs.some((r) => r.kind === "pending_candidate")).toBe(false);
  });

  it("ignores a candidate for a category that is not actually a gap", () => {
    const recs = buildSourceRecommendations({
      ...base,
      gaps: [],
      pendingCandidates: [
        { id: "c1", name: "Extra", coverageCategory: "athletics", confidence: 0.95, detectedAdapter: "sidearm" },
      ],
    });
    expect(recs).toEqual([]);
  });
});

describe("buildSourceRecommendations — discovery miss origins", () => {
  it("recommends a venue that keeps producing misses", () => {
    const recs = buildSourceRecommendations({
      ...base,
      missOrigins: [{ domain: "thevanguard.live", count: 3, hasCandidate: false, sampleTitle: "College Night @ The Vanguard" }],
    });
    expect(recs[0]!.priority).toBe("high");
    expect(recs[0]!.title).toBe("Add The Vanguard");
    expect(recs[0]!.reason).toMatch(/3 discovery misses/);
  });

  it("falls back to the domain when no readable venue name can be guessed", () => {
    const recs = buildSourceRecommendations({
      ...base,
      missOrigins: [{ domain: "someclub.example", count: 4, hasCandidate: false }],
    });
    expect(recs[0]!.title).toBe("Add someclub.example");
  });

  it("does not recommend a domain below the repetition threshold", () => {
    // One or two misses could be noise in the matching; three is a pattern.
    const recs = buildSourceRecommendations({
      ...base,
      missOrigins: [{ domain: "onetime.example", count: 2, hasCandidate: false }],
    });
    expect(recs).toEqual([]);
  });

  it("does not recommend a domain that already has a candidate", () => {
    // Recommending something already sitting in the review queue would be
    // redundant noise.
    const recs = buildSourceRecommendations({
      ...base,
      missOrigins: [{ domain: "known.example", count: 10, hasCandidate: true }],
    });
    expect(recs).toEqual([]);
  });
});

describe("buildSourceRecommendations — remaining gaps and organizations", () => {
  it("nudges toward an uncovered category with nothing to approve yet", () => {
    const recs = buildSourceRecommendations({ ...base, gaps: ["athletics"] });
    expect(recs[0]!.priority).toBe("medium");
    expect(recs[0]!.title).toMatch(/Athletics/);
  });

  it("groups unlinked organizations into one recommendation, not one per org", () => {
    const recs = buildSourceRecommendations({ ...base, unlinkedOrganizationCount: 17 });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.title).toBe("Add 17 student organization event channels");
  });

  it("uses singular phrasing for exactly one organization", () => {
    const recs = buildSourceRecommendations({ ...base, unlinkedOrganizationCount: 1 });
    expect(recs[0]!.title).toBe("Add 1 student organization event channel");
  });

  it("says nothing when there is nothing to recommend", () => {
    expect(buildSourceRecommendations(base)).toEqual([]);
  });
});

describe("buildSourceRecommendations — ordering", () => {
  it("always lists high priority before medium", () => {
    const recs = buildSourceRecommendations({
      ...base,
      gaps: ["athletics"],
      missOrigins: [{ domain: "venue.example", count: 5, hasCandidate: false }],
    });
    const priorities = recs.map((r) => r.priority);
    expect(priorities.indexOf("high")).toBeLessThan(priorities.indexOf("medium"));
  });
});
