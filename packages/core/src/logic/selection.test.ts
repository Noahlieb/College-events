import { describe, expect, it } from "vitest";
import { selectEventsForPost, type SelectableEvent, type SelectionOptions } from "./selection.js";
import type { EventCategory } from "../types/enums.js";

const TZ = "America/New_York";

/**
 * Fixed calendar rather than `Date.now() + n days`. Lane routing now depends
 * on an event's local day of week (weekend games go to the Thursday post),
 * so relative dates would make these assertions pass or fail depending on
 * which day the suite happens to run.
 *
 * 2026-08-17 is a Monday.
 */
const NOW = new Date("2026-08-17T09:00:00-04:00");
const dayOf = (offset: number, hour = 18) => {
  const d = new Date(`2026-08-17T${String(hour).padStart(2, "0")}:00:00-04:00`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString();
};
const MON = dayOf(0);
const TUE = dayOf(1);
const WED = dayOf(2);
const SAT = dayOf(5);
const YESTERDAY = dayOf(-1);

const bucketScores = (mondayCampus: number, midweekActivity = 40, thursdayNightlife = 10, overall = 50) => ({
  overall,
  mondayCampus,
  midweekActivity,
  thursdayNightlife,
});

const event = (
  id: string,
  score: number,
  startAt: string = WED,
  category: EventCategory = "campus",
): SelectableEvent => ({
  id,
  category,
  bucketScores: bucketScores(score),
  verificationStatus: "verified",
  startAt,
});

const MONDAY_OPTS = {
  postType: "monday_campus",
  bucket: "mondayCampus",
  timezone: TZ,
  maxSlides: 8,
  now: NOW,
} satisfies SelectionOptions;

const THURSDAY_OPTS = {
  postType: "thursday_nightlife",
  bucket: "thursdayNightlife",
  timezone: TZ,
  maxSlides: 8,
  now: NOW,
} satisfies SelectionOptions;

describe("selectEventsForPost", () => {
  it("ranks by bucket score descending", () => {
    const events = [event("low", 60), event("high", 95), event("mid", 78)];
    const selected = selectEventsForPost(events, MONDAY_OPTS);
    expect(selected.map((e) => e.id)).toEqual(["high", "mid", "low"]);
  });

  it("does not pad weak events just to hit maxSlides (quality over quantity)", () => {
    const events = [event("good-1", 90), event("good-2", 85), event("weak", 30)];
    const selected = selectEventsForPost(events, { ...MONDAY_OPTS, minScore: 55 });
    expect(selected).toHaveLength(2);
    expect(selected.map((e) => e.id)).not.toContain("weak");
  });

  it("excludes CONFLICT and REJECTED events even if they score well", () => {
    const events: SelectableEvent[] = [
      { ...event("conflicted", 95), verificationStatus: "conflict" },
      { ...event("rejected", 95), verificationStatus: "rejected" },
      event("clean", 80),
    ];
    const selected = selectEventsForPost(events, MONDAY_OPTS);
    expect(selected.map((e) => e.id)).toEqual(["clean"]);
  });

  it("excludes expired events", () => {
    const events = [event("future", 90, WED), event("past", 95, YESTERDAY)];
    const selected = selectEventsForPost(events, MONDAY_OPTS);
    expect(selected.map((e) => e.id)).toEqual(["future"]);
  });

  it("caps slides at maxSlides even with many strong candidates", () => {
    const events = Array.from({ length: 12 }, (_, i) => event(`e${i}`, 90 - i));
    const selected = selectEventsForPost(events, MONDAY_OPTS);
    expect(selected).toHaveLength(8);
  });

  it("excludes events that route elsewhere, no matter how well they score", () => {
    const events = [
      event("nightlife-banger", 100, WED, "nightlife"),
      event("concert", 99, WED, "concert"), // routes to no lane at all
      event("campus-ok", 60, WED, "campus"),
    ];
    const selected = selectEventsForPost(events, MONDAY_OPTS);
    expect(selected.map((e) => e.id)).toEqual(["campus-ok"]);
  });

  it("keeps campus events and weekday games out of the nightlife lane", () => {
    const nightlifeScores = (n: number) => ({ overall: 50, mondayCampus: 10, midweekActivity: 20, thursdayNightlife: n });
    const events: SelectableEvent[] = [
      { ...event("club", 0, WED, "nightlife"), bucketScores: nightlifeScores(95) },
      { ...event("tuesday-game", 0, TUE, "sports"), bucketScores: nightlifeScores(90) },
      { ...event("club-meeting", 0, WED, "student_org"), bucketScores: nightlifeScores(88) },
    ];
    const selected = selectEventsForPost(events, THURSDAY_OPTS);
    expect(selected.map((e) => e.id)).toEqual(["club"]);
  });

  it("includes a weekend game in the nightlife lane alongside nightlife", () => {
    const nightlifeScores = (n: number) => ({ overall: 50, mondayCampus: 10, midweekActivity: 20, thursdayNightlife: n });
    const events: SelectableEvent[] = [
      { ...event("club", 0, SAT, "nightlife"), bucketScores: nightlifeScores(90) },
      { ...event("saturday-game", 0, SAT, "sports"), bucketScores: nightlifeScores(95) },
    ];
    const selected = selectEventsForPost(events, THURSDAY_OPTS);
    expect(selected.map((e) => e.id)).toEqual(["saturday-game", "club"]);
  });

  it("sends a weekday game to the campus lane and keeps a weekend game out of it", () => {
    const events = [event("tuesday-game", 90, TUE, "sports"), event("saturday-game", 95, SAT, "sports")];
    const selected = selectEventsForPost(events, MONDAY_OPTS);
    expect(selected.map((e) => e.id)).toEqual(["tuesday-game"]);
  });

  it("returns nothing when no event routes to the lane, rather than falling back", () => {
    const events = [event("nightlife-only", 100, MON, "nightlife")];
    const selected = selectEventsForPost(events, MONDAY_OPTS);
    expect(selected).toEqual([]);
  });
});
