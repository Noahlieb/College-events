import { describe, expect, it } from "vitest";
import { classifyContentEligibility } from "./deal-eligibility.js";

describe("classifyContentEligibility", () => {
  it("rejects low scores", () => {
    expect(classifyContentEligibility(30, false)).toBe("reject");
  });

  it("routes mid scores to story_worthy", () => {
    expect(classifyContentEligibility(55, false)).toBe("story_worthy");
  });

  it("routes high scores to feed_worthy", () => {
    expect(classifyContentEligibility(90, false)).toBe("feed_worthy");
    expect(classifyContentEligibility(70, false)).toBe("feed_worthy");
  });

  it("routes evergreen deals to the library instead of the feed, even at a high score", () => {
    expect(classifyContentEligibility(90, true)).toBe("evergreen_library");
  });

  it("still rejects a low-scoring evergreen deal", () => {
    expect(classifyContentEligibility(20, true)).toBe("reject");
  });
});
