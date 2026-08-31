import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { addDays, isValid, parseISO } from "date-fns";

export interface EventDateInput {
  /** "YYYY-MM-DD" */
  date: string | null;
  /** "HH:mm" 24hr, or null if unknown */
  startTime: string | null;
  endTime?: string | null;
  timezone: string;
}

export interface ParsedEventDate {
  startAt: string; // ISO UTC
  endAt: string | null; // ISO UTC
  /** true when only a date was known and we defaulted the time */
  timeWasAssumed: boolean;
}

const DEFAULT_ASSUMED_TIME = "19:00"; // reasonable default for unspecified evening events

/**
 * Combine an AI-extracted date + local time (in the school's timezone) into
 * absolute UTC instants. Throws EventDateParseError on invalid/missing date —
 * callers must treat that as "cannot process," never guess.
 */
export function parseEventDate(input: EventDateInput): ParsedEventDate {
  if (!input.date) {
    throw new EventDateParseError("Missing event date");
  }
  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.exec(input.date);
  if (!dateMatch) {
    throw new EventDateParseError(`Unrecognized date format: ${input.date}`);
  }

  const timeWasAssumed = !input.startTime;
  const startTime = input.startTime ?? DEFAULT_ASSUMED_TIME;
  if (!/^\d{2}:\d{2}$/.test(startTime)) {
    throw new EventDateParseError(`Unrecognized time format: ${startTime}`);
  }

  const startLocal = parseISO(`${input.date}T${startTime}:00`);
  if (!isValid(startLocal)) {
    throw new EventDateParseError(
      `Could not construct a valid date from ${input.date} ${startTime}`,
    );
  }
  const startAtUtc = fromZonedTime(startLocal, input.timezone);

  let endAtUtc: Date | null = null;
  if (input.endTime && /^\d{2}:\d{2}$/.test(input.endTime)) {
    const endLocal = parseISO(`${input.date}T${input.endTime}:00`);
    if (isValid(endLocal)) {
      let end = fromZonedTime(endLocal, input.timezone);
      // handle events that end after midnight (e.g. nightlife 22:00-02:00)
      if (end.getTime() < startAtUtc.getTime()) {
        end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
      }
      endAtUtc = end;
    }
  }

  return {
    startAt: startAtUtc.toISOString(),
    endAt: endAtUtc ? endAtUtc.toISOString() : null,
    timeWasAssumed,
  };
}

export class EventDateParseError extends Error {}

/** The reverse of parseEventDate's date+time+timezone -> UTC combination:
 * splits a UTC ISO instant into its local calendar date and 24h time in
 * `timezone`. Used by importers that receive full ISO instants (e.g. a
 * Campus Labs Engage CSV export's `starts_on`/`ends_on`) instead of an
 * already-split date/time pair. Returns null for an unparseable instant
 * rather than throwing, so a bad cell can be reported as a row-level
 * import error instead of failing the whole batch. */
export function toLocalDateAndTime(isoInstant: string, timezone: string): { date: string; time: string } | null {
  const parsed = parseISO(isoInstant);
  if (!isValid(parsed)) return null;
  const zoned = toZonedTime(parsed, timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}`,
    time: `${pad(zoned.getHours())}:${pad(zoned.getMinutes())}`,
  };
}

/**
 * Turns an inclusive "YYYY-MM-DD" calendar-day range — as picked from a
 * date input, meaning the school's local calendar, not UTC — into a
 * [start, end) instant range for a `startAt >= start AND startAt < end`
 * query. Either side can be omitted for an open-ended range. The upper
 * bound is the *next* local day's midnight rather than "+24h" so a
 * DST transition on the boundary day doesn't clip or extend it by an hour.
 */
export function localDateRangeToUtc(
  from: string | null,
  to: string | null,
  timezone: string,
): { start: Date | null; end: Date | null } {
  const parseLocalMidnight = (d: string): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const local = parseISO(`${d}T00:00:00`);
    return isValid(local) ? local : null;
  };

  const fromLocal = from ? parseLocalMidnight(from) : null;
  const toLocal = to ? parseLocalMidnight(to) : null;

  return {
    start: fromLocal ? fromZonedTime(fromLocal, timezone) : null,
    end: toLocal ? fromZonedTime(addDays(toLocal, 1), timezone) : null,
  };
}

/** An event is expired once its end (or start, if no end) is in the past. */
export function isExpired(
  event: { startAt: string; endAt?: string | null },
  now: Date = new Date(),
): boolean {
  const cutoff = event.endAt ? parseISO(event.endAt) : parseISO(event.startAt);
  return cutoff.getTime() < now.getTime();
}

/** Days between now and the event's start, in the school's local timezone. */
export function daysUntil(
  startAtIso: string,
  timezone: string,
  now: Date = new Date(),
): number {
  const start = toZonedTime(parseISO(startAtIso), timezone);
  const nowZoned = toZonedTime(now, timezone);
  const msPerDay = 24 * 60 * 60 * 1000;
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const nowDay = Date.UTC(nowZoned.getFullYear(), nowZoned.getMonth(), nowZoned.getDate());
  return Math.round((startDay - nowDay) / msPerDay);
}
