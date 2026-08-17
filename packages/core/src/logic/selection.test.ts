import { describe, expect, it } from "vitest";
import { selectEventsForPost, type SelectableEvent } from "./selection.js";

const bucketScores = (mondayCampus: number, midweekActivity = 40, thursdayNightlife = 10, overall = 50) => ({
  overall,
  mondayCampus,
  midweekActivity,
  thursdayNightlife,
});

const event = (id: string, score: number, daysFromNow = 3): SelectableEvent => ({
  id,
  category: "campus",
  bucketScores: bucketScores(score),
  verificationStatus: "verified",
  startAt: new Date(Date.now() + daysFromNow * 86400000).toISOString(),
});

describe("selectEventsForPost", () => {
  it("ranks by bucket score descending", () => {
    const events = [event("low", 60), event("high", 95), event("mid", 78)];
    const selected = selectEventsForPost(events, { bucket: "mondayCampus", maxSlides: 8 });
    expect(selected.map((e) => e.id)).toEqual(["high", "mid", "low"]);
  });

  it("does not pad weak events just to hit maxSlides (quality over quantity)", () => {
    const events = [event("good-1", 90), event("good-2", 85), event("weak", 30)];
    const selected = selectEventsForPost(events, { bucket: "mondayCampus", maxSlides: 8, minScore: 55 });
    expect(selected).toHaveLength(2);
    expect(selected.map((e) => e.id)).not.toContain("weak");
  });

  it("excludes CONFLICT and REJECTED events even if they score well", () => {
    const events: SelectableEvent[] = [
      { ...event("conflicted", 95), verificationStatus: "conflict" },
      { ...event("rejected", 95), verificationStatus: "rejected" },
      event("clean", 80),
    ];
    const selected = selectEventsForPost(events, { bucket: "mondayCampus", maxSlides: 8 });
    expect(selected.map((e) => e.id)).toEqual(["clean"]);
  });

  it("excludes expired events", () => {
    const events = [event("future", 90, 2), event("past", 95, -2)];
    const selected = selectEventsForPost(events, { bucket: "mondayCampus", maxSlides: 8 });
    expect(selected.map((e) => e.id)).toEqual(["future"]);
  });

  it("caps slides at maxSlides even with many strong candidates", () => {
    const events = Array.from({ length: 12 }, (_, i) => event(`e${i}`, 90 - i));
    const selected = selectEventsForPost(events, { bucket: "mondayCampus", maxSlides: 8 });
    expect(selected).toHaveLength(8);
  });
});
