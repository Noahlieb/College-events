import { describe, expect, it } from "vitest";
import {
  LanePurityError,
  POST_LANES,
  assertLanePurity,
  isEventAllowedInLane,
  isWeekendEvent,
  laneForEvent,
  laneForPostType,
  isAwayIndicator,
} from "./lanes.js";
import { EVENT_CATEGORIES, type EventCategory } from "../types/enums.js";

const TZ = "America/New_York";

/** 2026-08-17 is a Monday, so +n days walks the week. */
const MONDAY = "2026-08-17";
const dayOf = (offset: number) => {
  const d = new Date(`${MONDAY}T18:00:00-04:00`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString();
};
const MON = dayOf(0);
const TUE = dayOf(1);
const WED = dayOf(2);
const THU = dayOf(3);
const FRI = dayOf(4);
const SAT = dayOf(5);
const SUN = dayOf(6);

const ev = (category: EventCategory, startAt: string) => ({ category, startAt, timezone: TZ });

describe("isWeekendEvent", () => {
  it("treats Fri, Sat and Sun as the weekend", () => {
    expect(isWeekendEvent(FRI, TZ)).toBe(true);
    expect(isWeekendEvent(SAT, TZ)).toBe(true);
    expect(isWeekendEvent(SUN, TZ)).toBe(true);
  });

  it("treats Mon through Thu as weekdays", () => {
    for (const d of [MON, TUE, WED, THU]) expect(isWeekendEvent(d, TZ)).toBe(false);
  });

  it("uses the school's local day, not UTC", () => {
    // 21:00 Friday in Florida is already 01:00 Saturday UTC. Both are the
    // weekend, so use a case where UTC would flip a weekday to a weekend:
    // 21:00 Thursday ET === 01:00 Friday UTC.
    const thursdayNight = "2026-08-20T21:00:00-04:00";
    expect(new Date(thursdayNight).getUTCDay()).toBe(5); // Friday in UTC
    expect(isWeekendEvent(thursdayNight, TZ)).toBe(false); // still Thursday locally
  });

  it("keeps a late Sunday game on the weekend even though UTC has rolled to Monday", () => {
    const sundayNight = "2026-08-23T20:00:00-04:00";
    expect(new Date(sundayNight).getUTCDay()).toBe(1); // Monday in UTC
    expect(isWeekendEvent(sundayNight, TZ)).toBe(true);
  });
});

describe("laneForEvent", () => {
  it("always routes nightlife to Thursday, whatever day it falls on", () => {
    for (const d of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
      expect(laneForEvent(ev("nightlife", d))?.postType).toBe("thursday_nightlife");
    }
  });

  it("always routes campus and student org events to Monday, including weekends", () => {
    for (const category of ["campus", "student_org"] as const) {
      for (const d of [MON, WED, SAT, SUN]) {
        expect(laneForEvent(ev(category, d))?.postType).toBe("monday_campus");
      }
    }
  });

  it("routes weekend sports to the Thursday weekend guide", () => {
    for (const d of [FRI, SAT, SUN]) {
      expect(laneForEvent(ev("sports", d))?.postType).toBe("thursday_nightlife");
    }
  });

  it("routes Mon-Thu sports to the Monday campus post", () => {
    for (const d of [MON, TUE, WED, THU]) {
      expect(laneForEvent(ev("sports", d))?.postType).toBe("monday_campus");
    }
  });

  it("leaves categories with no lane unassigned rather than defaulting them somewhere", () => {
    for (const category of ["concert", "party", "food_drink", "career", "academic"] as const) {
      expect(laneForEvent(ev(category, SAT))).toBeUndefined();
      expect(laneForEvent(ev(category, WED))).toBeUndefined();
    }
  });

  it("puts every event in at most one lane", () => {
    for (const category of EVENT_CATEGORIES) {
      for (const d of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
        const lane = laneForEvent(ev(category, d));
        const matches = POST_LANES.filter((l) => l.postType === lane?.postType);
        expect(matches.length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("isEventAllowedInLane", () => {
  it("keeps a Tuesday game out of the weekend guide", () => {
    expect(isEventAllowedInLane("thursday_nightlife", ev("sports", TUE))).toBe(false);
    expect(isEventAllowedInLane("monday_campus", ev("sports", TUE))).toBe(true);
  });

  it("keeps a Saturday game out of the Monday post", () => {
    expect(isEventAllowedInLane("monday_campus", ev("sports", SAT))).toBe(false);
    expect(isEventAllowedInLane("thursday_nightlife", ev("sports", SAT))).toBe(true);
  });

  it("keeps nightlife out of the campus post and campus out of the nightlife post", () => {
    expect(isEventAllowedInLane("monday_campus", ev("nightlife", SAT))).toBe(false);
    expect(isEventAllowedInLane("thursday_nightlife", ev("campus", SAT))).toBe(false);
  });

  it("treats a retired post type as allowing nothing", () => {
    expect(laneForPostType("midweek_activities")).toBeUndefined();
    expect(isEventAllowedInLane("midweek_activities", ev("campus", WED))).toBe(false);
  });
});

describe("assertLanePurity", () => {
  it("passes a Monday post of campus events and a weekday game", () => {
    expect(() =>
      assertLanePurity("monday_campus", [
        { id: "a", ...ev("campus", MON) },
        { id: "b", ...ev("sports", WED) },
      ]),
    ).not.toThrow();
  });

  it("passes a Thursday post of nightlife plus a Saturday game", () => {
    expect(() =>
      assertLanePurity("thursday_nightlife", [
        { id: "a", ...ev("nightlife", FRI) },
        { id: "b", ...ev("sports", SAT) },
      ]),
    ).not.toThrow();
  });

  it("throws when a weekday game reaches the weekend guide", () => {
    expect(() => assertLanePurity("thursday_nightlife", [{ id: "tue-game", ...ev("sports", TUE) }])).toThrow(
      LanePurityError,
    );
  });

  it("throws when nightlife reaches the campus post", () => {
    expect(() =>
      assertLanePurity("monday_campus", [
        { id: "ok", ...ev("campus", MON) },
        { id: "bad", ...ev("nightlife", FRI) },
      ]),
    ).toThrow(LanePurityError);
  });

  it("names the offending event and its category in the message", () => {
    try {
      assertLanePurity("thursday_nightlife", [{ id: "evt-42", ...ev("campus", SAT) }]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("evt-42");
      expect((err as Error).message).toContain("campus");
    }
  });

  it("accepts an empty post", () => {
    expect(() => assertLanePurity("thursday_nightlife", [])).not.toThrow();
  });
});

describe("home games only", () => {
  const game = (startAt: string, isHomeGame?: boolean | null) => ({
    category: "sports" as EventCategory,
    startAt,
    timezone: TZ,
    isHomeGame,
  });

  it("gives an away game no lane, whichever day it falls on", () => {
    for (const d of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
      expect(laneForEvent(game(d, false))).toBeUndefined();
    }
  });

  it("still routes home games by day", () => {
    expect(laneForEvent(game(SAT, true))?.postType).toBe("thursday_nightlife");
    expect(laneForEvent(game(TUE, true))?.postType).toBe("monday_campus");
  });

  it("treats unknown as postable, so intramurals aren't dropped", () => {
    // Only the athletics feed reports home/away; club and intramural events
    // arrive without it and are on campus by their nature.
    expect(laneForEvent(game(SAT, undefined))?.postType).toBe("thursday_nightlife");
    expect(laneForEvent(game(TUE, null))?.postType).toBe("monday_campus");
  });

  it("keeps an away game out of both posts", () => {
    expect(isEventAllowedInLane("thursday_nightlife", game(SAT, false))).toBe(false);
    expect(isEventAllowedInLane("monday_campus", game(TUE, false))).toBe(false);
  });

  it("refuses to build a post containing an away game", () => {
    expect(() => assertLanePurity("thursday_nightlife", [{ id: "road-game", ...game(SAT, false) }])).toThrow(
      LanePurityError,
    );
  });

  it("does not affect non-sports categories", () => {
    // isHomeGame is meaningless for a concert; it must not gate them.
    expect(laneForEvent({ category: "nightlife", startAt: SAT, timezone: TZ, isHomeGame: false })?.postType).toBe(
      "thursday_nightlife",
    );
    expect(laneForEvent({ category: "campus", startAt: TUE, timezone: TZ, isHomeGame: false })?.postType).toBe(
      "monday_campus",
    );
  });
});

describe("isAwayIndicator", () => {
  it("excludes only an affirmative away or neutral indicator", () => {
    for (const away of ["A", "N", "a", "n", " A ", "N "]) {
      expect(isAwayIndicator(away)).toBe(true);
    }
  });

  it("treats home, blank and absent as postable", () => {
    // Every source except the athletics feed omits this field entirely.
    for (const ok of ["H", "h", "", "   ", null, undefined, 0, 123, {}, [], NaN]) {
      expect(isAwayIndicator(ok)).toBe(false);
    }
  });
});
