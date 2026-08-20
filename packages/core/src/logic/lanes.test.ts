import { describe, expect, it } from "vitest";
import {
  LanePurityError,
  POST_LANES,
  assertLanePurity,
  isCategoryAllowedInLane,
  laneForCategory,
  laneForPostType,
} from "./lanes.js";
import { EVENT_CATEGORIES } from "../types/enums.js";

describe("post lanes", () => {
  it("defines exactly the two weekly lanes", () => {
    expect(POST_LANES.map((l) => l.postType)).toEqual(["monday_campus", "thursday_nightlife"]);
  });

  it("never lets one category belong to two lanes", () => {
    for (const category of EVENT_CATEGORIES) {
      const matches = POST_LANES.filter((l) => l.categories.includes(category));
      expect(matches.length, `${category} appears in ${matches.length} lanes`).toBeLessThanOrEqual(1);
    }
  });

  it("routes campus, student org and sports to the Monday post", () => {
    for (const category of ["campus", "student_org", "sports"] as const) {
      expect(laneForCategory(category)?.postType).toBe("monday_campus");
    }
  });

  it("routes nightlife to the Thursday post", () => {
    expect(laneForCategory("nightlife")?.postType).toBe("thursday_nightlife");
  });

  it("keeps nightlife out of the campus lane and campus out of the nightlife lane", () => {
    expect(isCategoryAllowedInLane("monday_campus", "nightlife")).toBe(false);
    expect(isCategoryAllowedInLane("thursday_nightlife", "campus")).toBe(false);
    expect(isCategoryAllowedInLane("thursday_nightlife", "sports")).toBe(false);
  });

  it("treats an unknown post type as allowing nothing", () => {
    expect(laneForPostType("midweek_activities")).toBeUndefined();
    expect(isCategoryAllowedInLane("midweek_activities", "campus")).toBe(false);
  });

  it("leaves categories with no lane unassigned rather than defaulting them somewhere", () => {
    // These are deliberately not auto-posted; a human can still force them in.
    for (const category of ["concert", "party", "food_drink", "career", "academic"] as const) {
      expect(laneForCategory(category)).toBeUndefined();
    }
  });
});

describe("assertLanePurity", () => {
  it("passes a post whose events all match the lane", () => {
    expect(() =>
      assertLanePurity("monday_campus", [
        { id: "a", category: "campus" },
        { id: "b", category: "sports" },
      ]),
    ).not.toThrow();
  });

  it("throws, naming the offenders, when an out-of-lane event slips through", () => {
    expect(() =>
      assertLanePurity("monday_campus", [
        { id: "ok", category: "campus" },
        { id: "bad", category: "nightlife" },
      ]),
    ).toThrow(LanePurityError);
  });

  it("names the offending event and its category in the message", () => {
    try {
      assertLanePurity("thursday_nightlife", [{ id: "evt-42", category: "sports" }]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("evt-42");
      expect((err as Error).message).toContain("sports");
    }
  });

  it("accepts an empty post", () => {
    expect(() => assertLanePurity("thursday_nightlife", [])).not.toThrow();
  });
});
