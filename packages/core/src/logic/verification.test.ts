import { describe, expect, it } from "vitest";
import { computeVerificationStatus } from "./verification.js";

describe("computeVerificationStatus", () => {
  it("marks VERIFIED when two reliable sources agree on time", () => {
    const { status } = computeVerificationStatus([
      { sourceId: "a", sourcePriority: 9, startAt: "2026-08-21T23:00:00.000Z" },
      { sourceId: "b", sourcePriority: 8, startAt: "2026-08-21T23:00:00.000Z" },
    ]);
    expect(status).toBe("verified");
  });

  it("marks HIGH_CONFIDENCE when only one reliable source exists", () => {
    const { status } = computeVerificationStatus([
      { sourceId: "a", sourcePriority: 9, startAt: "2026-08-21T23:00:00.000Z" },
    ]);
    expect(status).toBe("high_confidence");
  });

  it("marks CONFLICT when sources disagree on start time, e.g. athletics article says 7pm but schedule says 6pm", () => {
    const { status, reason } = computeVerificationStatus([
      { sourceId: "athletics-article", sourcePriority: 7, startAt: "2026-08-21T23:00:00.000Z" }, // 7pm ET
      { sourceId: "athletics-schedule", sourcePriority: 9, startAt: "2026-08-21T22:00:00.000Z" }, // 6pm ET
    ]);
    expect(status).toBe("conflict");
    expect(reason).toMatch(/disagree/);
  });

  it("marks NEEDS_REVIEW for a single low-priority source", () => {
    const { status } = computeVerificationStatus([
      { sourceId: "random-blog", sourcePriority: 2, startAt: "2026-08-21T23:00:00.000Z" },
    ]);
    expect(status).toBe("needs_review");
  });
});
