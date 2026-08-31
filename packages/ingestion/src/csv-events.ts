import { categorizeEvent, EVENT_CATEGORIES, toLocalDateAndTime, type EventCategory } from "@college-events/core";
import { parseCsvRecords, pickField } from "./csv.js";
import type { ManualEventInput } from "./manual.js";

export interface CsvEventRow {
  input: ManualEventInput;
  rowNumber: number; // 1-indexed, header excluded — for error reporting
}

export interface CsvParseError {
  rowNumber: number;
  reason: string;
}

export interface CsvParseResult {
  rows: CsvEventRow[];
  errors: CsvParseError[];
}

const CATEGORY_ALIASES: Record<string, EventCategory> = {
  campus: "campus",
  sports: "sports",
  nightlife: "nightlife",
  concert: "concert",
  party: "party",
  "food & drink": "food_drink",
  "food_drink": "food_drink",
  fitness: "fitness",
  comedy: "comedy",
  festival: "festival",
  career: "career",
  academic: "academic",
  networking: "networking",
  community: "community",
  "student org": "student_org",
  student_org: "student_org",
};

function resolveCategory(rawCategory: string, name: string, notes: string): EventCategory {
  const direct = CATEGORY_ALIASES[rawCategory.trim().toLowerCase()];
  // "Concert" in the Notes column is a stronger, more specific signal than
  // a broad CSV bucket like "Nightlife" — prefer it when present.
  const { category: guessed } = categorizeEvent({ name, description: notes });
  if (guessed !== "other" && /concert|festival stage/i.test(notes)) return guessed;
  if (direct) return direct;
  if (guessed !== "other") return guessed;
  return (EVENT_CATEGORIES as readonly string[]).includes(rawCategory.trim().toLowerCase() as EventCategory)
    ? (rawCategory.trim().toLowerCase() as EventCategory)
    : "other";
}

/** Converts "9:00 AM" / "9:00 AM–11:00 AM" / "9:00 AM-11:00 AM" (en-dash or
 * hyphen) into 24h "HH:MM" start/end. Returns null start when the field is
 * empty or unparseable — callers treat that as a fatal row error, since an
 * event needs at least a start time. */
function parseTimeRange(raw: string): { start: string | null; end: string | null } {
  if (!raw) return { start: null, end: null };
  const parts = raw.split(/[–-]/).map((p) => p.trim());
  const toH24 = (t: string): string | null => {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
    if (!m) return null;
    let h = parseInt(m[1]!, 10) % 12;
    if (m[3]!.toUpperCase() === "PM") h += 12;
    return `${String(h).padStart(2, "0")}:${m[2]}`;
  };
  const start = toH24(parts[0] ?? "");
  const end = parts[1] ? toH24(parts[1]) : null;
  return { start, end };
}

/** Splits a CSV "Venue" cell into a venue name and a city. The sample data
 * has three shapes: "FAU Soccer Stadium, Boca Raton" (venue + city),
 * "Tallahassee, FL" (away-game location only), and "FAU Boca Raton"
 * (no comma at all) — handled by taking the text after the last comma as
 * the city when a comma is present, else falling back to the whole string
 * as both venue and a best-guess city of `defaultCity`. */
function splitVenue(raw: string, defaultCity: string): { venue: string; city: string } {
  if (!raw) return { venue: "", city: defaultCity };
  const lastComma = raw.lastIndexOf(",");
  if (lastComma === -1) return { venue: raw, city: defaultCity };
  const before = raw.slice(0, lastComma).trim();
  const after = raw.slice(lastComma + 1).trim();
  // "Tallahassee, FL" — the part before the comma IS the city, not a venue name.
  if (/^[A-Z]{2}$/.test(after) && !before.includes(",")) return { venue: before, city: before };
  return { venue: before || raw, city: after.replace(/\bFL$/i, "").trim() || defaultCity };
}

/**
 * Parses a CSV of events into ManualEventInput rows ready for
 * submitManualEvent. Two column shapes are recognized, detected once from
 * the header row (a file is one shape or the other, never a mix):
 *
 * - This importer's own format: Date, Time (ET), Category, Event,
 *   Presenter/Team, Venue, Notes, Image URL, Link — see README.
 * - A Campus Labs Engage-style export: starts_on/ends_on ISO 8601
 *   instants, name, location, description, image_url, url, organization
 *   — no separate Date/Time columns.
 *
 * Column names are matched case-insensitively with a couple of common
 * aliases; required fields (Date/starts_on, Event/name, Time) missing on a
 * row produce a CsvParseError instead of throwing, so one bad row doesn't
 * fail the whole upload.
 */
export function parseEventsCsv(
  csvText: string,
  opts: { defaultCity: string; submittedBy: string; timezone?: string },
): CsvParseResult {
  const records = parseCsvRecords(csvText);
  const rows: CsvEventRow[] = [];
  const errors: CsvParseError[] = [];
  // Only the Engage branch needs a timezone (to convert its UTC instants
  // into local wall-clock date/time); the standard format's Date/Time
  // columns are already local and get combined with the school's real
  // timezone later, downstream in submitManualEvent. Defaults to FAU's
  // zone so existing callers that don't pass one are unaffected.
  const timezone = opts.timezone ?? "America/New_York";

  const headers = records.length > 0 ? Object.keys(records[0]!).map((h) => h.trim().toLowerCase()) : [];
  const isEngageExport = headers.includes("starts_on") && !headers.includes("date");

  records.forEach((record, idx) => {
    const rowNumber = idx + 1;
    if (isEngageExport) {
      parseEngageRow(record, rowNumber, { ...opts, timezone }, rows, errors);
    } else {
      parseStandardRow(record, rowNumber, opts, rows, errors);
    }
  });

  return { rows, errors };
}

function parseStandardRow(
  record: Record<string, string>,
  rowNumber: number,
  opts: { defaultCity: string; submittedBy: string },
  rows: CsvEventRow[],
  errors: CsvParseError[],
): void {
  const name = pickField(record, "Event", "Name", "Title");
  const date = pickField(record, "Date");
  const timeRaw = pickField(record, "Time (ET)", "Time", "Time (EST)");
  const rawCategory = pickField(record, "Category");
  const presenter = pickField(record, "Presenter/Team", "Presenter", "Organization", "Team");
  const venueRaw = pickField(record, "Venue", "Location");
  const notes = pickField(record, "Notes", "Description");
  const imageUrl = pickField(record, "Image URL", "Image", "Photo URL");
  const link = pickField(record, "Link", "URL", "Event URL");

  if (!name) {
    errors.push({ rowNumber, reason: "missing Event/Name" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push({ rowNumber, reason: `missing or unparseable Date ("${date}") — expected YYYY-MM-DD` });
    return;
  }
  const { start, end } = parseTimeRange(timeRaw);
  if (!start) {
    errors.push({ rowNumber, reason: `missing or unparseable Time ("${timeRaw}") — expected "9:00 AM" or "9:00 AM-11:00 AM"` });
    return;
  }

  const { venue, city } = splitVenue(venueRaw, opts.defaultCity);
  const category = resolveCategory(rawCategory, name, notes);
  const ageRequirement = /\b21\+/.test(`${name} ${notes}`) ? "21+" : null;
  const isRecurring = /\brecurring\b/i.test(notes);
  const description = [notes, venueRaw && venue !== venueRaw ? venueRaw : null].filter(Boolean).join(" — ") || name;

  rows.push({
    rowNumber,
    input: {
      name,
      date,
      startTime: start,
      endTime: end,
      venue: venue || null,
      city: city || null,
      price: null, // not present in this CSV format; left for a human/AI to fill in later
      description,
      flyerUrl: imageUrl || null,
      sourceUrl: link || null,
      category,
      organization: presenter || null,
      ageRequirement,
      isRecurring,
      submittedBy: opts.submittedBy,
    },
  });
}

function parseEngageRow(
  record: Record<string, string>,
  rowNumber: number,
  opts: { defaultCity: string; submittedBy: string; timezone: string },
  rows: CsvEventRow[],
  errors: CsvParseError[],
): void {
  const name = pickField(record, "name", "Event", "Title");
  const startsOn = pickField(record, "starts_on");
  const endsOn = pickField(record, "ends_on");
  const venueRaw = pickField(record, "location", "Venue");
  const notes = pickField(record, "description", "Notes");
  const imageUrl = pickField(record, "image_url", "Image URL");
  const link = pickField(record, "url", "Link");
  const presenter = pickField(record, "organization", "Presenter/Team");

  if (!name) {
    errors.push({ rowNumber, reason: "missing Event/Name" });
    return;
  }

  const start = toLocalDateAndTime(startsOn, opts.timezone);
  if (!start) {
    errors.push({ rowNumber, reason: `missing or unparseable starts_on ("${startsOn}") — expected an ISO 8601 datetime` });
    return;
  }

  // A multi-day span (e.g. a tabling event running Mon-Fri) can't be
  // represented by this importer's single-date model — only keep the end
  // clock time when it falls on the same local calendar day as the start;
  // otherwise leave it null rather than mis-stating a multi-day event as a
  // few-hour one.
  const end = endsOn ? toLocalDateAndTime(endsOn, opts.timezone) : null;
  const endTime = end && end.date === start.date ? end.time : null;

  const { venue, city } = splitVenue(venueRaw, opts.defaultCity);
  const category = resolveCategory("", name, notes); // no explicit Category column in this export
  const ageRequirement = /\b21\+/.test(`${name} ${notes}`) ? "21+" : null;
  const isRecurring = /\brecurring\b/i.test(notes);
  const description = [notes, venueRaw && venue !== venueRaw ? venueRaw : null].filter(Boolean).join(" — ") || name;

  rows.push({
    rowNumber,
    input: {
      name,
      date: start.date,
      startTime: start.time,
      endTime,
      venue: venue || null,
      city: city || null,
      price: null,
      description,
      flyerUrl: imageUrl || null,
      sourceUrl: link || null,
      category,
      organization: presenter || null,
      ageRequirement,
      isRecurring,
      submittedBy: opts.submittedBy,
    },
  });
}
