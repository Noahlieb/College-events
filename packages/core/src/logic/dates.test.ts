import { describe, expect, it } from "vitest";
import { EventDateParseError, daysUntil, isExpired, parseEventDate } from "./dates.js";

const NYC = "America/New_York"; // FAU (Boca Raton) is US/Eastern

describe("parseEventDate", () => {
  it("combines date + local time into a correct UTC instant", () => {
    const result = parseEventDate({
      date: "2026-08-21",
      startTime: "22:00",
      endTime: null,
      timezone: NYC,
    });
    // Aug 21 2026 is EDT (UTC-4) -> 22:00 local = 02:00 UTC next day
    expect(result.startAt).toBe("2026-08-22T02:00:00.000Z");
    expect(result.timeWasAssumed).toBe(false);
  });

  it("rolls the end time to the next day when it is earlier than start (overnight event)", () => {
    const result = parseEventDate({
      date: "2026-08-21",
      startTime: "22:00",
      endTime: "02:00",
      timezone: NYC,
    });
    expect(result.endAt).toBe("2026-08-22T06:00:00.000Z");
  });

  it("assumes a default evening time when start time is unknown, and flags it", () => {
    const result = parseEventDate({ date: "2026-08-21", startTime: null, timezone: NYC });
    expect(result.timeWasAssumed).toBe(true);
  });

  it("throws rather than guessing when the date is missing", () => {
    expect(() => parseEventDate({ date: null, startTime: "19:00", timezone: NYC })).toThrow(
      EventDateParseError,
    );
  });

  it("throws on malformed date strings instead of silently misparsing", () => {
    expect(() => parseEventDate({ date: "08/21/2026", startTime: "19:00", timezone: NYC })).toThrow(
      EventDateParseError,
    );
  });
});

describe("isExpired", () => {
  it("treats an event as expired once its end time has passed", () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    expect(isExpired({ startAt: "2026-08-21T22:00:00.000Z", endAt: "2026-08-22T02:00:00.000Z" }, now)).toBe(
      true,
    );
  });

  it("falls back to start time when no end time is known", () => {
    const now = new Date("2026-08-21T23:00:00.000Z");
    expect(isExpired({ startAt: "2026-08-21T22:00:00.000Z" }, now)).toBe(true);
    expect(isExpired({ startAt: "2026-08-22T22:00:00.000Z" }, now)).toBe(false);
  });
});

describe("daysUntil", () => {
  it("computes calendar-day distance in the school timezone, not raw hours", () => {
    // 11pm Eastern on the 20th is still "the 20th" locally even though UTC has rolled to the 21st
    const now = new Date("2026-08-21T02:30:00.000Z"); // 10:30pm Aug 20 Eastern
    const days = daysUntil("2026-08-22T02:00:00.000Z", NYC, now); // 10pm Aug 21 Eastern
    expect(days).toBe(1);
  });
});
