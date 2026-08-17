import { eq, and } from "drizzle-orm";
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
 * instead of one. Attaches every row to the school's manual_submission
 * utility source (seeded as "Manual Entry"), since a curated CSV is
 * conceptually the same thing: a human already verified these details.
 */
export async function importCsvEvents(schoolId: string, csvText: string, submittedBy = "csv-upload"): Promise<CsvImportSummary> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school ${schoolId}`);

  const [manualSource] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.schoolId, schoolId), eq(sources.sourceType, "manual_submission")))
    .limit(1);
  if (!manualSource) {
    throw new Error(
      "No manual_submission source configured for this school — add one on the Sources page (type: manual submission) before importing a CSV.",
    );
  }

  const { rows, errors: parseErrors } = parseEventsCsv(csvText, { defaultCity: school.city, submittedBy });

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
