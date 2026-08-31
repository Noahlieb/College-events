import { eq, and, asc, ilike, or } from "drizzle-orm";
import { db, schools, sources } from "@college-events/db";
import { parseEventsCsv } from "@college-events/ingestion";
import { submitManualEvent } from "./manual.js";

type SchoolRow = typeof schools.$inferSelect;
type SourceRow = typeof sources.$inferSelect;

/** The manual_submission source rows for a school, in creation order —
 * cached per school so a multi-school CSV doesn't re-query this once per
 * row for schools it has already resolved. */
async function manualSourcesFor(schoolId: string): Promise<SourceRow[]> {
  return db
    .select()
    .from(sources)
    .where(and(eq(sources.schoolId, schoolId), eq(sources.sourceType, "manual_submission")))
    .orderBy(asc(sources.createdAt));
}

/**
 * Resolves a row's University/School/Campus text to a school, matching its
 * short name or full name case-insensitively. Not exact-only: an operator
 * pasting "UCF" or "University of Central Florida" should both work without
 * needing to know which form the database has stored — and neither should
 * a scraper's informal shorthand ("MIAMI" for "University of Miami"), so an
 * exact miss falls back to a substring match before giving up.
 */
async function findSchoolByHint(hint: string): Promise<SchoolRow | null> {
  const trimmed = hint.trim();
  if (!trimmed) return null;

  const [exact] = await db
    .select()
    .from(schools)
    .where(or(ilike(schools.shortName, trimmed), ilike(schools.name, trimmed)))
    .limit(1);
  if (exact) return exact;

  const [fuzzy] = await db
    .select()
    .from(schools)
    .where(or(ilike(schools.name, `%${trimmed}%`), ilike(schools.shortName, `%${trimmed}%`)))
    .limit(1);
  return fuzzy ?? null;
}

export interface CsvImportSummary {
  totalRows: number;
  created: number;
  merged: number;
  parseErrors: { rowNumber: number; reason: string }[];
  submitErrors: { rowNumber: number; eventName: string; reason: string }[];
  /** A row's University/School/Campus column didn't match any known
   * school. Reported separately from submitErrors because the fix is
   * "add that university first or fix the spelling," not "fix this event." */
  routingErrors: { rowNumber: number; university: string; reason: string }[];
  /** Per-school breakdown, for a CSV that spanned more than one university —
   * "12 created" alone doesn't say whether that was one school or five. */
  bySchool: { schoolId: string; schoolShortName: string; created: number; merged: number }[];
}

/**
 * Bulk-imports a CSV of events (see packages/ingestion/src/csv-events.ts
 * for the expected columns) by running each row through the exact same
 * submitManualEvent() path a single manual entry uses — same dedup,
 * scoring, and verification logic, just looped over many structured rows
 * instead of one. Attaches every row to a manual_submission source for the
 * school, so a curated/scraped-then-reviewed CSV feed is attributable —
 * different feeds (e.g. separate scraper scripts for different venues)
 * should use different named sources rather than piling into one bucket.
 *
 * `schoolId` is the *default* target, not the only one: a row carrying a
 * University/School/Campus value routes to that school instead, so one
 * upload can cover several universities at once. A hint that doesn't match
 * any known school is a routing error on that row, never a silent fallback
 * to the default — misrouting an event to the wrong university's calendar
 * is worse than rejecting it and saying why.
 *
 * When sourceName is given, it must exactly match an existing
 * manual_submission source for the *default* school — never guessed or
 * auto-created, so a typo'd --source flag fails loudly instead of quietly
 * attaching rows to the wrong feed. Rows routed to a different school via a
 * University hint always use that school's own oldest manual_submission
 * source; a --source override chosen for the default school has no
 * meaningful equivalent on a school the caller didn't name. When omitted
 * entirely (e.g. the dashboard upload form, which has no source picker
 * yet), the default school also falls back to its oldest manual_submission
 * source — the originally-seeded "Manual Entry" one, deterministically,
 * regardless of how many scraper-specific sources get added later.
 */
export async function importCsvEvents(
  schoolId: string,
  csvText: string,
  submittedBy = "csv-upload",
  sourceName?: string,
): Promise<CsvImportSummary> {
  const [defaultSchool] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!defaultSchool) throw new Error(`Unknown school ${schoolId}`);

  const [defaultManualSource] = await db
    .select()
    .from(sources)
    .where(
      sourceName
        ? and(eq(sources.schoolId, schoolId), eq(sources.sourceType, "manual_submission"), eq(sources.name, sourceName))
        : and(eq(sources.schoolId, schoolId), eq(sources.sourceType, "manual_submission")),
    )
    .orderBy(asc(sources.createdAt))
    .limit(1);
  if (!defaultManualSource) {
    throw new Error(
      sourceName
        ? `No manual_submission source named "${sourceName}" configured for this school — create it on the Sources page (type: manual submission) first; it won't be auto-created.`
        : "No manual_submission source configured for this school — add one on the Sources page (type: manual submission) before importing a CSV.",
    );
  }

  const { rows, errors: parseErrors } = parseEventsCsv(csvText, {
    defaultCity: defaultSchool.city,
    submittedBy,
    timezone: defaultSchool.timezone,
  });

  const summary: CsvImportSummary = {
    totalRows: rows.length + parseErrors.length,
    created: 0,
    merged: 0,
    parseErrors,
    submitErrors: [],
    routingErrors: [],
    bySchool: [],
  };

  // Resolved once per distinct hint, not once per row — a thousand-row CSV
  // for five schools should be five lookups, not a thousand.
  const schoolCache = new Map<string, SchoolRow | null>();
  const manualSourceCache = new Map<string, SourceRow[]>();
  const tallies = new Map<string, { schoolShortName: string; created: number; merged: number }>();

  for (const row of rows) {
    let targetSchool = defaultSchool;
    let manualSource = defaultManualSource;

    if (row.universityHint) {
      const hint = row.universityHint;
      if (!schoolCache.has(hint)) schoolCache.set(hint, await findSchoolByHint(hint));
      const resolved = schoolCache.get(hint) ?? null;
      if (!resolved) {
        summary.routingErrors.push({
          rowNumber: row.rowNumber,
          university: hint,
          reason: `No school found matching "${hint}" — add it via "Add University" first, or fix the spelling.`,
        });
        continue;
      }
      targetSchool = resolved;

      if (targetSchool.id !== schoolId) {
        if (!manualSourceCache.has(targetSchool.id)) {
          manualSourceCache.set(targetSchool.id, await manualSourcesFor(targetSchool.id));
        }
        const [oldest] = manualSourceCache.get(targetSchool.id)!;
        if (!oldest) {
          summary.routingErrors.push({
            rowNumber: row.rowNumber,
            university: hint,
            reason: `"${targetSchool.name}" has no manual_submission source configured — add one on its Sources page before importing rows for it.`,
          });
          continue;
        }
        manualSource = oldest;
      }
    }

    try {
      const result = await submitManualEvent(targetSchool.id, manualSource.id, row.input);
      const tally = tallies.get(targetSchool.id) ?? { schoolShortName: targetSchool.shortName, created: 0, merged: 0 };
      if (result.merged) tally.merged++;
      else tally.created++;
      tallies.set(targetSchool.id, tally);

      if (result.merged) summary.merged++;
      else summary.created++;
    } catch (err) {
      summary.submitErrors.push({
        rowNumber: row.rowNumber,
        eventName: row.input.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  summary.bySchool = [...tallies.entries()].map(([id, t]) => ({ schoolId: id, ...t }));
  return summary;
}
