import { describe, expect, it } from "vitest";
import { findEventMatch, guessDateFromText, type KnownEvent } from "./discovery-miss.js";

const NOW = new Date("2026-08-25T12:00:00Z");

describe("guessDateFromText", () => {
  it("reads a named month and day", () => {
    const date = guessDateFromText("Join us September 5 for a night out", NOW);
    expect(date?.getUTCMonth()).toBe(8);
    expect(date?.getUTCDate()).toBe(5);
  });

  it("reads an abbreviated month", () => {
    const date = guessDateFromText("Sept. 5 — doors at 9", NOW);
    expect(date?.getUTCMonth()).toBe(8);
  });

  it("reads a numeric date", () => {
    const date = guessDateFromText("9/5 event", NOW);
    expect(date?.getUTCMonth()).toBe(8);
    expect(date?.getUTCDate()).toBe(5);
  });

  it("rolls an early month into next year when discovered late in the current one", () => {
    // Discovered in November about a "January 10" event — almost
    // certainly next January, not one that already passed.
    const lateYear = new Date("2026-11-01T00:00:00Z");
    const date = guessDateFromText("January 10 kickoff", lateYear);
    expect(date?.getUTCFullYear()).toBe(2027);
  });

  it("returns null rather than guessing wrong from ambiguous text", () => {
    expect(guessDateFromText("Come party with us", NOW)).toBeNull();
  });

  it("ignores an out-of-range day", () => {
    expect(guessDateFromText("September 45", NOW)).toBeNull();
  });
});

describe("findEventMatch", () => {
  const known: KnownEvent[] = [
    { id: "e1", name: "Neon Night at The Vanguard", startAt: "2026-09-05T22:00:00Z" },
    { id: "e2", name: "Homecoming Tailgate", startAt: "2026-09-06T14:00:00Z" },
  ];

  it("matches on a strong title with a corroborating date", () => {
    const match = findEventMatch(
      { title: "Neon Night — The Vanguard, Sept 5", url: "https://x" },
      known,
      NOW,
    );
    expect(match?.id).toBe("e1");
  });

  it("still matches on a strong title alone when no date can be extracted", () => {
    const match = findEventMatch({ title: "Neon Night at The Vanguard", url: "https://x" }, known, NOW);
    expect(match?.id).toBe("e1");
  });

  it("does not match a genuinely different event", () => {
    const match = findEventMatch({ title: "Career Fair Info Session", url: "https://x" }, known, NOW);
    expect(match).toBeNull();
  });

  it("lets a disagreeing date pull a borderline title below the threshold", () => {
    // A moderate title match on the wrong date is weaker evidence than
    // the same title with no date opinion at all.
    const match = findEventMatch(
      { title: "Homecoming Weekend Kickoff", snippet: "January 3", url: "https://x" },
      known,
      NOW,
    );
    expect(match).toBeNull();
  });

  it("returns null against an empty known-events list", () => {
    expect(findEventMatch({ title: "Anything", url: "https://x" }, [], NOW)).toBeNull();
  });

  it("picks the better of two plausible titles", () => {
    const twoSimilar: KnownEvent[] = [
      { id: "close", name: "Neon Night at The Vanguard", startAt: "2026-09-05T22:00:00Z" },
      { id: "far", name: "Neon Nights Music Series", startAt: "2026-09-05T22:00:00Z" },
    ];
    const match = findEventMatch({ title: "Neon Night at The Vanguard", url: "https://x" }, twoSimilar, NOW);
    expect(match?.id).toBe("close");
  });
});
