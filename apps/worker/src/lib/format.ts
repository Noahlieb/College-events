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
