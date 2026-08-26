function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

/** "AUGUST 22ND" in the school's local timezone. */
export function formatDateKicker(iso: string, tz: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", day: "numeric" }).formatToParts(date);
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parseInt(parts.find((p) => p.type === "day")!.value, 10);
  return `${month.toUpperCase()} ${ordinal(day)}`;
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

/** "@fau.events" — normalized to always carry exactly one leading "@",
 * regardless of whether the school record was entered with one. Falls back
 * to the short name, matching render.ts's wordmark fallback. */
export function formatInstagramHandle(instagramAccount: string | null, shortName: string): string {
  const raw = instagramAccount || shortName.toLowerCase();
  return `@${raw.replace(/^@/, "")}`;
}
