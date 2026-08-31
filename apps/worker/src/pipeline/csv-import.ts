import { eq, and, asc } from "drizzle-orm";
import { db, schools, sources } from "@college-events/db";
import { parseEventsCsv } from "@college-events/ingestion";
import { submitManualEvent } from "./manual.js";

export interface CsvImportSummary {
  totalRows: number;
  created: number;
  merged: number;
  parseErrors: { rowNumber: number; reason: string }[];
  submitErrors: { rowNumber: number; eventName: string; reason: string }[];
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
 * When sourceName is given, it must exactly match an existing
 * manual_submission source for this school — never guessed or
 * auto-created, so a typo'd --source flag fails loudly instead of quietly
 * attaching rows to the wrong feed. When omitted (e.g. the dashboard
 * upload form, which has no source picker yet), falls back to the
 * school's oldest manual_submission source — the originally-seeded
 * "Manual Entry" one, deterministically, regardless of how many
 * scraper-specific sources get added later.
 */
export async function importCsvEvents(
  schoolId: string,
  csvText: string,
  submittedBy = "csv-upload",
  sourceName?: string,
): Promise<CsvImportSummary> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school ${schoolId}`);

  const [manualSource] = await db
    .select()
    .from(sources)
    .where(
      sourceName
        ? and(eq(sources.schoolId, schoolId), eq(sources.sourceType, "manual_submission"), eq(sources.name, sourceName))
        : and(eq(sources.schoolId, schoolId), eq(sources.sourceType, "manual_submission")),
    )
    .orderBy(asc(sources.createdAt))
    .limit(1);
  if (!manualSource) {
    throw new Error(
      sourceName
        ? `No manual_submission source named "${sourceName}" configured for this school — create it on the Sources page (type: manual submission) first; it won't be auto-created.`
        : "No manual_submission source configured for this school — add one on the Sources page (type: manual submission) before importing a CSV.",
    );
  }

  const { rows, errors: parseErrors } = parseEventsCsv(csvText, { defaultCity: school.city, submittedBy, timezone: school.timezone });

  const summary: CsvImportSummary = { totalRows: rows.length + parseErrors.length, created: 0, merged: 0, parseErrors, submitErrors: [] };

  for (const row of rows) {
    try {
      const result = await submitManualEvent(schoolId, manualSource.id, row.input);
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

  return summary;
}
