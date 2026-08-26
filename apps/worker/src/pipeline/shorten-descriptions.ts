import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db, events } from "@college-events/db";
import { createAIProvider, type AIProvider } from "@college-events/ai";
import { shortenDescriptionIfNeeded } from "../lib/summarize.js";

export interface ShortenDescriptionsSummary {
  inspected: number;
  shortened: number;
  unchanged: number;
  failed: number;
}

/**
 * One-time backfill for events that predate shortenDescriptionIfNeeded
 * being wired into process.ts/manual.ts (see those files) — the auto-
 * shorten only ever ran at creation/merge time, so anything already in the
 * database when that shipped is still carrying its original, possibly
 * very long, raw description. Safe to re-run: an already-short
 * description is a no-op, and shortenDescriptionIfNeeded itself never
 * throws on an AI failure, it just leaves that one row untouched.
 */
export async function shortenExistingDescriptions(
  schoolId: string,
  aiProvider: AIProvider = createAIProvider(),
): Promise<ShortenDescriptionsSummary> {
  const rows = await db
    .select({ id: events.id, name: events.name, description: events.description })
    .from(events)
    .where(and(eq(events.schoolId, schoolId), isNotNull(events.description), ne(events.status, "rejected")));

  const summary: ShortenDescriptionsSummary = { inspected: 0, shortened: 0, unchanged: 0, failed: 0 };

  for (const row of rows) {
    summary.inspected++;
    try {
      const shortened = await shortenDescriptionIfNeeded(aiProvider, row.description, row.name);
      if (shortened !== row.description) {
        await db.update(events).set({ description: shortened }).where(eq(events.id, row.id));
        summary.shortened++;
      } else {
        summary.unchanged++;
      }
    } catch {
      // shortenDescriptionIfNeeded already swallows AI failures internally;
      // this only catches an unexpected DB error, so one bad row doesn't
      // abort the rest of the school's backfill.
      summary.failed++;
    }
  }

  return summary;
}
