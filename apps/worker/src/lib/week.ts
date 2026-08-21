/** Monday of the ISO week containing `reference` (most recent Monday on or before it). */
export function mondayOfWeek(reference: Date): Date {
  const d = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d;
}

/** "AUGUST 24–30" (or "AUGUST 31 – SEPTEMBER 6" when the week spans a month boundary). */
export function formatWeekRangeLabel(weekMonday: Date): string {
  const sunday = new Date(weekMonday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
  const startMonth = monthFmt.format(weekMonday);
  const endMonth = monthFmt.format(sunday);
  const startDay = weekMonday.getUTCDate();
  const endDay = sunday.getUTCDate();
  if (startMonth === endMonth) {
    return `${startMonth.toUpperCase()} ${startDay}–${endDay}`;
  }
  return `${startMonth.toUpperCase()} ${startDay} – ${endMonth.toUpperCase()} ${endDay}`;
}
