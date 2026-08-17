import { describe, expect, it } from "vitest";
import { areDuplicates, clusterDuplicates, titleSimilarity } from "./dedup.js";

describe("titleSimilarity", () => {
  it("treats minor wording differences as highly similar", () => {
    expect(titleSimilarity("Back to School Bash", "Back 2 School Bash!")).toBeGreaterThan(0.7);
  });

  it("treats unrelated titles as dissimilar", () => {
    expect(titleSimilarity("FAU Career Fair", "Bounce Nightclub College Night")).toBeLessThan(0.3);
  });
});

describe("areDuplicates", () => {
  it("flags the same event posted on Owl Central and Instagram as a duplicate", () => {
    const owlCentral = {
      id: "raw-1",
      name: "FAU Fall Involvement Fair",
      startAt: "2026-08-24T17:00:00.000Z",
      venue: "Student Union Breezeway",
      organization: "FAU Student Involvement",
    };
    const instagram = {
      id: "raw-2",
      name: "Fall Involvement Fair @ FAU",
      startAt: "2026-08-24T17:15:00.000Z",
      venue: "Student Union",
      organization: "FAU Student Involvement",
    };
    const result = areDuplicates(owlCentral, instagram);
    expect(result.isDuplicate).toBe(true);
  });

  it("does not merge two different events that merely share a date", () => {
    const a = {
      id: "raw-3",
      name: "FAU Owls Basketball vs UCF",
      startAt: "2026-08-24T19:00:00.000Z",
      venue: "Eleanor R. Baldwin Arena",
    };
    const b = {
      id: "raw-4",
      name: "Bounce Delray College Night",
      startAt: "2026-08-24T22:00:00.000Z",
      venue: "Bounce Delray",
    };
    expect(areDuplicates(a, b).isDuplicate).toBe(false);
  });

  it("does not merge same-titled recurring listings on different days", () => {
    const a = {
      id: "raw-5",
      name: "Weekly Happy Hour",
      startAt: "2026-08-20T22:00:00.000Z",
      venue: "The Break",
    };
    const b = {
      id: "raw-6",
      name: "Weekly Happy Hour",
      startAt: "2026-08-27T22:00:00.000Z",
      venue: "The Break",
    };
    expect(areDuplicates(a, b).isDuplicate).toBe(false);
  });
});

describe("clusterDuplicates", () => {
  it("groups three-source duplicates into a single cluster and leaves distinct events separate", () => {
    const events = [
      { id: "1", name: "Back to School Bash", startAt: "2026-08-24T17:00:00.000Z", venue: "Student Union" },
      { id: "2", name: "Back 2 School Bash", startAt: "2026-08-24T17:10:00.000Z", venue: "Student Union" },
      { id: "3", name: "Back-to-School Bash!", startAt: "2026-08-24T17:05:00.000Z", venue: "FAU Student Union" },
      { id: "4", name: "FAU Career Fair", startAt: "2026-08-25T13:00:00.000Z", venue: "Live Oak Pavilion" },
    ];
    const clusters = clusterDuplicates(events);
    expect(clusters).toHaveLength(2);
    const sizes = clusters.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 3]);
  });
});
