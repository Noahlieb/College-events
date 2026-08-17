import { and, eq } from "drizzle-orm";
import { db, rawContent, sources } from "@college-events/db";
import { adapterForSourceType } from "@college-events/ingestion";
import { log } from "../lib/log.js";

export interface IngestSummary {
  sourcesChecked: number;
  discovered: number;
  duplicatesSkipped: number;
  noAdapter: number;
  failed: number;
}

/**
 * Polls every active, adapter-backed source for a school and inserts any
 * newly-discovered items into raw_content as `pending` (spec §8/§27).
 * Instagram sources are skipped here — they're fed by the PhantomBuster
 * importer (apps/worker `ingest:phantombuster`) instead of a live poll.
 * A single source failing never aborts the run; it's logged and the
 * source's consecutive_failures counter increments for dashboard health
 * monitoring (spec §30).
 */
export async function ingestSchoolSources(schoolId: string, maxItemsPerSource = 10): Promise<IngestSummary> {
  const activeSources = await db
    .select()
    .from(sources)
    .where(and(eq(sources.schoolId, schoolId), eq(sources.active, true)));

  const summary: IngestSummary = { sourcesChecked: 0, discovered: 0, duplicatesSkipped: 0, noAdapter: 0, failed: 0 };

  for (const source of activeSources) {
    summary.sourcesChecked++;
    const adapter = adapterForSourceType(source.sourceType);
    if (!adapter) {
      summary.noAdapter++;
      continue;
    }

    try {
      const items = await adapter.fetchNew({
        source: {
          id: source.id,
          url: source.url,
          instagramHandle: source.instagramHandle,
          metadata: source.metadata,
        },
        lastSuccessfulCheckAt: source.lastSuccessfulCheckAt,
        maxItems: maxItemsPerSource,
      });

      for (const item of items) {
        const inserted = await db
          .insert(rawContent)
          .values({
            schoolId,
            sourceId: source.id,
            externalId: item.externalId,
            sourceUrl: item.sourceUrl,
            rawText: item.rawText,
            mediaUrl: item.mediaUrl,
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
            processingStatus: "pending",
            rawMetadata: item.rawMetadata ?? {},
          })
          .onConflictDoNothing({ target: [rawContent.sourceId, rawContent.externalId] })
          .returning({ id: rawContent.id });

        if (inserted.length > 0) summary.discovered++;
        else summary.duplicatesSkipped++;
      }

      await db
        .update(sources)
        .set({ lastCheckedAt: new Date(), lastSuccessfulCheckAt: new Date(), consecutiveFailures: 0 })
        .where(eq(sources.id, source.id));
    } catch (err) {
      summary.failed++;
      await db
        .update(sources)
        .set({ lastCheckedAt: new Date(), consecutiveFailures: source.consecutiveFailures + 1 })
        .where(eq(sources.id, source.id));
      await log(schoolId, "error", "ingestion", `Source "${source.name}" failed: ${(err as Error).message}`, {
        sourceId: source.id,
      });
    }
  }

  return summary;
}
