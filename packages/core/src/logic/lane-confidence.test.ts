import { describe, expect, it } from "vitest";
import { laneConfidence, type LaneSelectionHistoryEntry } from "./lane-confidence.js";

const event = (overrides: Partial<{ venue: string | null; sourceName: string | null; category: string; resolvedLane: string | null }> = {}) => ({
  venue: "The Wharf",
  sourceName: "Posh.vip",
  category: "nightlife",
  resolvedLane: "thursday_nightlife",
  ...overrides,
});

const entry = (overrides: Partial<LaneSelectionHistoryEntry> = {}): LaneSelectionHistoryEntry => ({
  venue: "The Wharf",
  sourceName: "Posh.vip",
  category: "nightlife",
  lane: "thursday_nightlife",
  ...overrides,
});

describe("laneConfidence", () => {
  it("returns unknown when there is no history at all", () => {
    expect(laneConfidence(event(), [])).toEqual({
      level: "unknown",
      reason: "No selection history yet for this venue or source/category.",
    });
  });

  it("returns high confidence when venue history strongly agrees with the resolved lane", () => {
    const result = laneConfidence(event(), [entry(), entry(), entry()]);
    expect(result.level).toBe("high");
    expect(result.reason).toContain("this venue");
  });

  it("returns low confidence when venue history disagrees with the resolved lane", () => {
    const result = laneConfidence(event(), [entry({ lane: "monday_campus" }), entry({ lane: "monday_campus" })]);
    expect(result.level).toBe("low");
    expect(result.reason).toContain("monday_campus");
  });

  it("counts a cleared pin (lane: null) as a real 'no post' outcome", () => {
    const result = laneConfidence(event(), [entry({ lane: null }), entry({ lane: null })]);
    expect(result.level).toBe("low");
    expect(result.reason).toContain("no post");
  });

  it("matches venue case-insensitively and trims whitespace", () => {
    const result = laneConfidence(event({ venue: "the wharf " }), [entry({ venue: " The Wharf" })]);
    expect(result.level).not.toBe("unknown");
  });

  it("falls back to source+category history when no venue match exists", () => {
    const result = laneConfidence(event({ venue: "A New Venue" }), [
      entry({ venue: "Culture Room" }),
      entry({ venue: "Culture Room" }),
    ]);
    expect(result.level).toBe("high");
    expect(result.reason).toContain("source and category");
  });

  it("prefers venue history over source/category history even when both exist", () => {
    // Only the venue-matching entry counts here — a differently-venued
    // source/category entry that disagrees must not drag this down, even
    // though it would (correctly) be the deciding history if no venue
    // match existed at all.
    const result = laneConfidence(event(), [
      entry(), // venue match, agrees
      entry({ venue: "Culture Room", lane: "monday_campus" }), // source/category match, disagrees — ignored
    ]);
    expect(result.level).toBe("medium"); // single agreeing venue data point
  });

  it("returns medium confidence for a single agreeing data point", () => {
    const result = laneConfidence(event(), [entry()]);
    expect(result.level).toBe("medium");
  });

  it("returns medium confidence when agreement is split but the resolved lane still leads", () => {
    const result = laneConfidence(event(), [entry(), entry(), entry({ lane: "monday_campus" })]);
    expect(result.level).toBe("medium");
  });
});
