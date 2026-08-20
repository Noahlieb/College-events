import { describe, expect, it } from "vitest";
import { selectEventsForPost, type SelectableEvent } from "./selection.js";
import type { EventCategory } from "../types/enums.js";

const bucketScores = (mondayCampus: number, midweekActivity = 40, thursdayNightlife = 10, overall = 50) => ({
  overall,
  mondayCampus,
  midweekActivity,
  thursdayNightlife,
});

const event = (id: string, score: number, daysFromNow = 3, category: EventCategory = "campus"): SelectableEvent => ({
  id,
  category,
  bucketScores: bucketScores(score),
  verificationStatus: "verified",
  startAt: new Date(Date.now() + daysFromNow * 86400000).toISOString(),
});

/** The campus lane's real category set — see logic/lanes.ts. */
const CAMPUS_LANE = ["campus", "student_org", "sports"] as const;

describe("selectEventsForPost", () => {
  it("ranks by bucket score descending", () => {
    const events = [event("low", 60), event("high", 95), event("mid", 78)];
    const selected = selectEventsForPost(events, {
      bucket: "mondayCampus",
      allowedCategories: CAMPUS_LANE,
      maxSlides: 8,
    });
    expect(selected.map((e) => e.id)).toEqual(["high", "mid", "low"]);
  });

  it("does not pad weak events just to hit maxSlides (quality over quantity)", () => {
    const events = [event("good-1", 90), event("good-2", 85), event("weak", 30)];
    const selected = selectEventsForPost(events, {
      bucket: "mondayCampus",
      allowedCategories: CAMPUS_LANE,
      maxSlides: 8,
      minScore: 55,
    });
    expect(selected).toHaveLength(2);
    expect(selected.map((e) => e.id)).not.toContain("weak");
  });

  it("excludes CONFLICT and REJECTED events even if they score well", () => {
    const events: SelectableEvent[] = [
      { ...event("conflicted", 95), verificationStatus: "conflict" },
      { ...event("rejected", 95), verificationStatus: "rejected" },
      event("clean", 80),
    ];
    const selected = selectEventsForPost(events, {
      bucket: "mondayCampus",
      allowedCategories: CAMPUS_LANE,
      maxSlides: 8,
    });
    expect(selected.map((e) => e.id)).toEqual(["clean"]);
  });

  it("excludes expired events", () => {
    const events = [event("future", 90, 2), event("past", 95, -2)];
    const selected = selectEventsForPost(events, {
      bucket: "mondayCampus",
      allowedCategories: CAMPUS_LANE,
      maxSlides: 8,
    });
    expect(selected.map((e) => e.id)).toEqual(["future"]);
  });

  it("caps slides at maxSlides even with many strong candidates", () => {
    const events = Array.from({ length: 12 }, (_, i) => event(`e${i}`, 90 - i));
    const selected = selectEventsForPost(events, {
      bucket: "mondayCampus",
      allowedCategories: CAMPUS_LANE,
      maxSlides: 8,
    });
    expect(selected).toHaveLength(8);
  });

  it("excludes out-of-lane categories no matter how well they score", () => {
    const events = [
      event("nightlife-banger", 100, 3, "nightlife"),
      event("concert", 99, 3, "concert"),
      event("campus-ok", 60, 3, "campus"),
    ];
    const selected = selectEventsForPost(events, {
      bucket: "mondayCampus",
      allowedCategories: CAMPUS_LANE,
      maxSlides: 8,
    });
    expect(selected.map((e) => e.id)).toEqual(["campus-ok"]);
  });

  it("keeps the nightlife lane free of campus and sports events", () => {
    const nightlifeScores = (n: number) => ({ overall: 50, mondayCampus: 10, midweekActivity: 20, thursdayNightlife: n });
    const events: SelectableEvent[] = [
      { ...event("club", 10, 3, "nightlife"), bucketScores: nightlifeScores(95) },
      { ...event("game", 10, 3, "sports"), bucketScores: nightlifeScores(90) },
      { ...event("club-meeting", 10, 3, "student_org"), bucketScores: nightlifeScores(88) },
    ];
    const selected = selectEventsForPost(events, {
      bucket: "thursdayNightlife",
      allowedCategories: ["nightlife"],
      maxSlides: 8,
    });
    expect(selected.map((e) => e.id)).toEqual(["club"]);
  });

  it("returns nothing when no event matches the lane, rather than falling back", () => {
    const events = [event("nightlife-only", 100, 3, "nightlife")];
    const selected = selectEventsForPost(events, {
      bucket: "mondayCampus",
      allowedCategories: CAMPUS_LANE,
      maxSlides: 8,
    });
    expect(selected).toEqual([]);
  });
});
