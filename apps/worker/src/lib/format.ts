function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

function monthDay(iso: string, tz: string): { month: string; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", day: "numeric" }).formatToParts(
    new Date(iso),
  );
  return { month: parts.find((p) => p.type === "month")!.value, day: parseInt(parts.find((p) => p.type === "day")!.value, 10) };
}

/**
 * "AUGUST 22ND" in the school's local timezone, or "AUGUST 22ND–23RD" (or
 * "AUGUST 31ST–SEPTEMBER 1ST" across a month boundary) when `endIso` falls
 * on a different calendar day there — a 2-day conference gets one flyer
 * with a date range instead of looking like a single-day event. Calendar
 * day is compared in the school's own timezone, not the raw instants: an
 * 11PM–1AM event technically crosses midnight but isn't what "spans
 * multiple days" means here.
 */
export function formatDateKicker(iso: string, tz: string, endIso?: string | null): string {
  const start = monthDay(iso, tz);
  const startLabel = `${start.month.toUpperCase()} ${ordinal(start.day)}`;
  if (!endIso) return startLabel;

  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  if (dayFmt.format(new Date(iso)) === dayFmt.format(new Date(endIso))) return startLabel;

  const end = monthDay(endIso, tz);
  const endLabel = start.month === end.month ? ordinal(end.day) : `${end.month.toUpperCase()} ${ordinal(end.day)}`;
  return `${startLabel}–${endLabel}`;
}

function formatClock(iso: string, tz: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
  return formatted.replace(":00 ", "").replace(" ", "").toUpperCase();
}

/** "5PM–8:30PM", or just "5PM" when there's no known end time. */
export function formatTimeRange(startIso: string, endIso: string | null, tz: string): string {
  const start = formatClock(startIso, tz);
  if (!endIso) return start;
  return `${start}–${formatClock(endIso, tz)}`;
}

/** Same as formatTimeRange but with "to" instead of an en-dash, for caption
 * body text where the slide's tighter dash notation reads oddly in prose. */
export function formatCaptionTimeRange(startIso: string, endIso: string | null, tz: string): string {
  const start = formatClock(startIso, tz);
  if (!endIso) return start;
  return `${start} to ${formatClock(endIso, tz)}`;
}

/** "MONDAY 8/24" in the school's local timezone — the caption's per-day
 * section header. */
export function formatCaptionDayLabel(iso: string, tz: string): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(date);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric", day: "numeric" }).formatToParts(
    date,
  );
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${weekday.toUpperCase()} ${month}/${day}`;
}

/** "August 24 to 30" (or "August 31 to September 6" across a month
 * boundary) — the caption's prose-style week span, distinct from
 * formatWeekRangeLabel's all-caps en-dash slide kicker. */
export function formatWeekRangeSentence(weekMonday: Date): string {
  const sunday = new Date(weekMonday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
  const startMonth = monthFmt.format(weekMonday);
  const endMonth = monthFmt.format(sunday);
  const startDay = weekMonday.getUTCDate();
  const endDay = sunday.getUTCDate();
  if (startMonth === endMonth) return `${startMonth} ${startDay} to ${endDay}`;
  return `${startMonth} ${startDay} to ${endMonth} ${endDay}`;
}

/** Phrases scraped sources use in place of a real venue when the location
 * is access-gated rather than genuinely unknown ("Sign in to see location"
 * is Facebook/Eventbrite's own wording for an RSVP-gated address). Matched
 * as a substring since these show up embedded in longer sentences, not
 * just as the whole field. */
const RESTRICTED_VENUE_RE = /sign[\s-]?in|log[\s-]?in|members?\s+only|private\s+event|rsvp|invite\s+only/i;
/** Placeholder text some sources put in the venue field instead of leaving
 * it empty — treated the same as no venue at all. */
const PLACEHOLDER_VENUE_RE = /^(tbd|n\/a|na|unknown|none|location tbd)$/i;

/**
 * "USF, Tampa" when a venue is missing or is one of the access-gated/
 * placeholder patterns above; otherwise the venue as given. `city` should
 * be the event's own city when known, else the school's.
 */
export function resolveVenueLabel(venue: string | null, schoolShortName: string, city: string): string {
  const trimmed = venue?.trim() ?? "";
  const hidden = !trimmed || PLACEHOLDER_VENUE_RE.test(trimmed) || RESTRICTED_VENUE_RE.test(trimmed);
  return hidden ? `${schoolShortName}, ${city}` : trimmed;
}

/**
 * Some sources have nothing to say about an event beyond its (missing or
 * access-gated) location, and that text ends up duplicated into the
 * description field too — "Private Location (sign in to display), Tampa"
 * as a whole description adds nothing the venue line doesn't already say.
 * Returns null in that case so the slide just omits the description block
 * entirely rather than printing a second, more verbose copy of "no venue."
 */
export function resolveDescriptionLabel(description: string | null): string | null {
  const trimmed = description?.trim() ?? "";
  if (!trimmed) return null;
  if (PLACEHOLDER_VENUE_RE.test(trimmed) || RESTRICTED_VENUE_RE.test(trimmed)) return null;
  return trimmed;
}

/** "@fau.events" — normalized to always carry exactly one leading "@",
 * regardless of whether the school record was entered with one. Falls back
 * to the short name, matching render.ts's wordmark fallback. */
export function formatInstagramHandle(instagramAccount: string | null, shortName: string): string {
  const raw = instagramAccount || shortName.toLowerCase();
  return `@${raw.replace(/^@/, "")}`;
}
