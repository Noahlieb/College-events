import { categorizeEvent, EVENT_CATEGORIES, toLocalDateAndTime, type EventCategory } from "@college-events/core";
import { parseCsvRecords, pickField } from "./csv.js";
import type { ManualEventInput } from "./manual.js";

export interface CsvEventRow {
  input: ManualEventInput;
  rowNumber: number; // 1-indexed, header excluded — for error reporting
  /** Raw text from a University/School/Campus column, when the row has one.
   * Null means "use whatever school the caller is importing into" — a
   * single-school CSV never needs this column at all. Left unresolved here
   * on purpose: this package has no database access, so turning this into
   * an actual school id is the importer's job, not the parser's. */
  universityHint: string | null;
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
 * Parses a CSV of events (columns: Date, Time (ET), Category, Event,
 * Presenter/Team, Venue, Notes, Image URL, Link, University — see README)
 * into ManualEventInput rows ready for submitManualEvent. Column names are
 * matched case-insensitively with a couple of common aliases; required
 * columns (Date, Event, Time) missing on a row produce a CsvParseError
 * instead of throwing, so one bad row doesn't fail the whole upload.
 *
 * University is optional and only matters for a multi-school upload: a row
 * with no value there targets whatever school the caller is importing into.
 */
function parseSpreadsheetEventsCsv(csvText: string, opts: { defaultCity: string; submittedBy: string }): CsvParseResult {
  const records = parseCsvRecords(csvText);
  const rows: CsvEventRow[] = [];
  const errors: CsvParseError[] = [];

  records.forEach((record, idx) => {
    const rowNumber = idx + 1;
    const name = pickField(record, "Event", "Name", "Title");
    const date = pickField(record, "Date");
    const timeRaw = pickField(record, "Time (ET)", "Time", "Time (EST)");
    const rawCategory = pickField(record, "Category");
    const presenter = pickField(record, "Presenter/Team", "Presenter", "Organization", "Team");
    const venueRaw = pickField(record, "Venue", "Location");
    const notes = pickField(record, "Notes", "Description");
    const imageUrl = pickField(record, "Image URL", "Image", "Photo URL");
    const link = pickField(record, "Link", "URL", "Event URL");
    const university = pickField(record, "University", "School", "Campus");

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
      universityHint: university || null,
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
  });

  return { rows, errors };
}

/** Splits a street address into just the city — "2435 N Miami Ave, Miami,
 * FL 33137, USA" -> "Miami". The posh.vip scraper (scrape_posh.py) always
 * emits this "street, city, state zip, country" shape, so the city is
 * reliably the second comma-separated segment. */
function cityFromAddress(address: string, defaultCity: string): string {
  const parts = address.split(",").map((p) => p.trim());
  return parts[1] || defaultCity;
}

/**
 * "2026-08-27T22:00:00-04:00" -> { date: "2026-08-27", time: "22:00" }.
 * Sliced directly out of the string rather than reparsed through a Date
 * and re-zoned: the offset in these timestamps already matches the
 * school's own local time (the scraper writes wall-clock local time, not
 * true UTC-normalized time), so converting through a timezone library
 * would double-apply the offset. Taking the digits as printed is correct.
 */
function splitLocalIso(iso: string): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? { date: m[1]!, time: m[2]! } : null;
}

/**
 * Parses the alternate schema produced by the posh.vip scraper
 * (scrape_posh.py): scraped_at, school, name, start_date, end_date, venue,
 * address, organizer, description, image_url, event_url. There's no
 * Category column at all here, so categorizeEvent's text-matching is the
 * primary signal rather than a fallback the way it is in
 * parseSpreadsheetEventsCsv.
 */
function parsePoshEventsCsv(csvText: string, opts: { defaultCity: string; submittedBy: string }): CsvParseResult {
  const records = parseCsvRecords(csvText);
  const rows: CsvEventRow[] = [];
  const errors: CsvParseError[] = [];

  records.forEach((record, idx) => {
    const rowNumber = idx + 1;
    const name = pickField(record, "name", "Event", "Title");
    const startDateRaw = pickField(record, "start_date", "Start Date");
    const endDateRaw = pickField(record, "end_date", "End Date");
    const venue = pickField(record, "venue", "Venue");
    const address = pickField(record, "address", "Address");
    const organizer = pickField(record, "organizer", "Organizer");
    const description = pickField(record, "description", "Notes");
    const imageUrl = pickField(record, "image_url", "Image URL");
    const eventUrl = pickField(record, "event_url", "Link", "URL");
    const university = pickField(record, "school", "University", "Campus");

    if (!name) {
      errors.push({ rowNumber, reason: "missing name" });
      return;
    }
    const start = splitLocalIso(startDateRaw);
    if (!start) {
      errors.push({
        rowNumber,
        reason: `missing or unparseable start_date ("${startDateRaw}") — expected an ISO timestamp`,
      });
      return;
    }
    const end = endDateRaw ? splitLocalIso(endDateRaw) : null;

    const city = address ? cityFromAddress(address, opts.defaultCity) : opts.defaultCity;
    const { category } = categorizeEvent({ name, description, organization: organizer });
    const ageRequirement = /\b21\+/.test(`${name} ${description}`) ? "21+" : null;

    rows.push({
      rowNumber,
      universityHint: university || null,
      input: {
        name,
        date: start.date,
        startTime: start.time,
        endTime: end?.time ?? null,
        venue: venue || null,
        city: city || null,
        price: null, // not present in this scraper's output
        description: description || name,
        flyerUrl: imageUrl || null,
        sourceUrl: eventUrl || null,
        category,
        organization: organizer || null,
        ageRequirement,
        isRecurring: /\brecurring\b/i.test(description),
        submittedBy: opts.submittedBy,
      },
    });
  });

  return { rows, errors };
}

/**
 * Parses a Campus Labs Engage export: school, platform, name, organization,
 * starts_on, ends_on, location, description, url, image_url. Unlike
 * posh.vip's start_date/end_date (already local wall-clock text, see
 * splitLocalIso above), Engage's starts_on/ends_on are genuine UTC instants
 * (Campus Labs' API convention) — e.g. "2026-08-31T13:00:00+00:00" for a
 * 9am Eastern event — so they need a real timezone conversion, via
 * toLocalDateAndTime, rather than a direct slice of the string.
 */
function parseEngageEventsCsv(csvText: string, opts: { defaultCity: string; submittedBy: string; timezone: string }): CsvParseResult {
  const records = parseCsvRecords(csvText);
  const rows: CsvEventRow[] = [];
  const errors: CsvParseError[] = [];

  records.forEach((record, idx) => {
    const rowNumber = idx + 1;
    const name = pickField(record, "name", "Event", "Title");
    const startsOn = pickField(record, "starts_on");
    const endsOn = pickField(record, "ends_on");
    const venueRaw = pickField(record, "location", "Venue");
    const notes = pickField(record, "description", "Notes");
    const imageUrl = pickField(record, "image_url", "Image URL");
    const link = pickField(record, "url", "Link");
    const presenter = pickField(record, "organization", "Presenter/Team");
    const university = pickField(record, "school", "University", "Campus");

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
    // clock time when it falls on the same local calendar day as the
    // start; otherwise leave it null rather than mis-stating a multi-day
    // event as a few-hour one.
    const end = endsOn ? toLocalDateAndTime(endsOn, opts.timezone) : null;
    const endTime = end && end.date === start.date ? end.time : null;

    const { venue, city } = splitVenue(venueRaw, opts.defaultCity);
    const category = resolveCategory("", name, notes); // no explicit Category column in this export
    const ageRequirement = /\b21\+/.test(`${name} ${notes}`) ? "21+" : null;
    const isRecurring = /\brecurring\b/i.test(notes);
    const description = [notes, venueRaw && venue !== venueRaw ? venueRaw : null].filter(Boolean).join(" — ") || name;

    rows.push({
      rowNumber,
      universityHint: university || null,
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
  });

  return { rows, errors };
}

/**
 * Single entry point for all accepted CSV shapes — the manual/spreadsheet
 * format (Date, Event, Time (ET), ...), the posh.vip scraper's own export
 * format (start_date, name, event_url, ...), and a Campus Labs Engage
 * export (starts_on, name, location, ...). Dispatches purely on which
 * columns the header row actually has, so callers (the dashboard's import
 * action, the worker CLI) never need to know or ask which format a given
 * file is in.
 *
 * `timezone` only matters for the Engage format's UTC->local conversion
 * (defaults to America/New_York, same FAU-centric default `defaultCity`
 * already implies elsewhere in this file); like `defaultCity`, a single
 * value is applied across the whole file even when individual rows route
 * to different schools via their own University/School column — accurate
 * for the common case of one region's schools sharing a timezone, same
 * tradeoff this parser already makes for defaultCity.
 */
export function parseEventsCsv(csvText: string, opts: { defaultCity: string; submittedBy: string; timezone?: string }): CsvParseResult {
  const headerLine = csvText.split(/\r?\n/, 1)[0] ?? "";
  const isPoshFormat = /(^|,)\s*start_date\s*(,|$)/i.test(headerLine);
  if (isPoshFormat) return parsePoshEventsCsv(csvText, opts);

  const isEngageFormat = /(^|,)\s*starts_on\s*(,|$)/i.test(headerLine) && !/(^|,)\s*date\s*(,|$)/i.test(headerLine);
  if (isEngageFormat) return parseEngageEventsCsv(csvText, { ...opts, timezone: opts.timezone ?? "America/New_York" });

  return parseSpreadsheetEventsCsv(csvText, opts);
}
