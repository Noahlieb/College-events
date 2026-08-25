import { and, eq } from "drizzle-orm";
import { db, rawContent, sources } from "@college-events/db";
import {
  SourceAccessDeniedError,
  adapterFor,
  adapterForSourceType,
  type CrawlContext,
  type DiscoveredEvent,
  type SourceInstance,
} from "@college-events/ingestion";
import {
  evaluateSourceHealth,
  nextRunAfter,
  type AdapterType,
  type EventCategory,
  type SourceHealthStatus,
} from "@college-events/core";
import { log } from "../lib/log.js";

/** What actually happened, so callers don't have to infer it from health. */
export type SourceRunOutcome =
  | "ok"
  | "no_adapter"
  | "access_denied" // platform declined automated access — not a defect
  | "error";

export interface SourceRunResult {
  sourceId: string;
  sourceName: string;
  adapterType: AdapterType | null;
  outcome: SourceRunOutcome;
  discovered: number;
  duplicatesSkipped: number;
  itemsSeen: number;
  health: SourceHealthStatus;
  reason?: string;
}

export interface IngestSummary {
  sourcesChecked: number;
  discovered: number;
  duplicatesSkipped: number;
  noAdapter: number;
  failed: number;
  degraded: number;
  runs: SourceRunResult[];
}

type SourceRow = typeof sources.$inferSelect;

/**
 * Builds the university-agnostic view of a source that adapters receive.
 * Everything school-specific an adapter could need is in here — and only
 * in here. An adapter that reached for a school name would have nothing to
 * reach for.
 */
export function toSourceInstance(source: SourceRow): SourceInstance {
  return {
    id: source.id,
    schoolId: source.schoolId,
    name: source.name,
    adapterType: (source.adapterType ?? "generic_web") as AdapterType,
    url: source.url,
    discoveryUrl: source.discoveryUrl,
    instagramHandle: source.instagramHandle,
    config: source.config ?? {},
    metadata: source.metadata ?? {},
    categoryBias:
      (source.categoryBias as EventCategory | null) ??
      ((source.metadata as { forceCategory?: EventCategory })?.forceCategory ?? null),
    lastSuccessfulCheckAt: source.lastSuccessfulCheckAt,
    lastEventFoundAt: source.lastEventFoundAt,
  };
}

async function persistItems(
  schoolId: string,
  sourceId: string,
  items: DiscoveredEvent[],
): Promise<{ discovered: number; duplicatesSkipped: number }> {
  let discovered = 0;
  let duplicatesSkipped = 0;

  for (const item of items) {
    const inserted = await db
      .insert(rawContent)
      .values({
        schoolId,
        sourceId,
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

    if (inserted.length > 0) discovered++;
    else duplicatesSkipped++;
  }
  return { discovered, duplicatesSkipped };
}

/**
 * Crawls one source and writes what it found straight into `raw_content`.
 *
 * This is the common ingestion path every automated source now takes.
 * Previously two of the three live FAU sources reached the database via
 * `python → CSV → import-csv`, which meant automated ingestion only ran
 * where a Python cron ran and every field survived a lossy trip through
 * flat text. CSV remains available as an admin utility (`import-csv`); it
 * is no longer the integration boundary.
 *
 * Never throws. A source's failure is recorded on that source and returned
 * to the caller — one bad platform must not take down the other twenty.
 */
export async function runSource(
  source: SourceRow,
  context: CrawlContext = {},
): Promise<SourceRunResult> {
  const instance = toSourceInstance(source);
  const adapter =
    (source.adapterType ? adapterFor(source.adapterType as AdapterType) : null) ?? null;

  const base: SourceRunResult = {
    sourceId: source.id,
    sourceName: source.name,
    adapterType: (source.adapterType as AdapterType) ?? null,
    outcome: "ok",
    discovered: 0,
    duplicatesSkipped: 0,
    itemsSeen: 0,
    health: source.healthStatus,
  };

  // Legacy fallback: a source whose adapter_type has no registered adapter
  // yet still crawls through the pre-refactor source_type lookup, so the
  // migration can land before every platform has a native adapter.
  const legacy = adapter ? null : adapterForSourceType(source.sourceType);
  if (!adapter && !legacy) {
    return {
      ...base,
      outcome: "no_adapter",
      health: source.healthStatus,
      reason: `no adapter registered for "${source.adapterType ?? source.sourceType}"`,
    };
  }

  const now = context.now ?? new Date();

  try {
    const items = adapter
      ? await adapter.discover(instance, context)
      : await legacy!.fetchNew({
          source: {
            id: source.id,
            url: source.discoveryUrl ?? source.url,
            instagramHandle: source.instagramHandle,
            metadata: source.metadata,
          },
          lastSuccessfulCheckAt: source.lastSuccessfulCheckAt,
          maxItems: context.maxItems,
          fetchImpl: context.fetchImpl,
        });

    const { discovered, duplicatesSkipped } = await persistItems(source.schoolId, source.id, items);
    const health = evaluateSourceHealth({
      itemsSeen: items.length,
      discovered,
      hasYieldedBefore: source.lastEventFoundAt != null,
      consecutiveFailures: 0,
    });

    await db
      .update(sources)
      .set({
        lastCheckedAt: now,
        lastSuccessfulCheckAt: now,
        ...(discovered > 0 ? { lastEventFoundAt: now } : {}),
        consecutiveFailures: 0,
        healthStatus: health.status,
        healthReason: health.reason ?? null,
        nextRunAt: nextRunAfter(now, source.crawlIntervalMinutes, health.status),
      })
      .where(eq(sources.id, source.id));

    return {
      ...base,
      outcome: "ok",
      discovered,
      duplicatesSkipped,
      itemsSeen: items.length,
      health: health.status,
      reason: health.reason,
    };
  } catch (err) {
    // A platform declining automated access is DEGRADED, not FAILED. It is
    // not a defect, retrying harder is not the answer, and other sources
    // are expected to cover the same events.
    const denied = err instanceof SourceAccessDeniedError;
    const reason = (err as Error).message;
    const consecutiveFailures = source.consecutiveFailures + 1;
    const { status } = evaluateSourceHealth({
      itemsSeen: 0,
      discovered: 0,
      hasYieldedBefore: source.lastEventFoundAt != null,
      consecutiveFailures,
      error: { kind: denied ? "access_denied" : "error", message: reason },
    });

    await db
      .update(sources)
      .set({
        lastCheckedAt: now,
        consecutiveFailures,
        healthStatus: status,
        healthReason: reason,
        // A degraded source backs off well past its normal interval rather
        // than retrying into the same wall on the next tick.
        nextRunAt: nextRunAfter(now, source.crawlIntervalMinutes, status),
      })
      .where(eq(sources.id, source.id));

    await log(
      source.schoolId,
      denied ? "warn" : "error",
      "ingestion",
      denied
        ? `Source "${source.name}" declined automated access: ${reason}`
        : `Source "${source.name}" failed: ${reason}`,
      { sourceId: source.id, adapterType: source.adapterType, kind: denied ? "access_denied" : "error" },
    );

    return { ...base, outcome: denied ? "access_denied" : "error", health: status, reason };
  }
}

/**
 * Polls every active, adapter-backed source for a university. Each source
 * runs independently: a failure, a challenge, or a missing adapter affects
 * only that source's row in the summary.
 */
export async function ingestSchoolSources(
  schoolId: string,
  maxItemsPerSource = 10,
  context: CrawlContext = {},
): Promise<IngestSummary> {
  const activeSources = await db
    .select()
    .from(sources)
    .where(and(eq(sources.schoolId, schoolId), eq(sources.active, true)));

  const summary: IngestSummary = {
    sourcesChecked: 0,
    discovered: 0,
    duplicatesSkipped: 0,
    noAdapter: 0,
    failed: 0,
    degraded: 0,
    runs: [],
  };

  for (const source of activeSources) {
    summary.sourcesChecked++;
    const result = await runSource(source, { maxItems: maxItemsPerSource, ...context });
    summary.runs.push(result);
    summary.discovered += result.discovered;
    summary.duplicatesSkipped += result.duplicatesSkipped;
    if (result.outcome === "no_adapter") summary.noAdapter++;
    if (result.outcome === "access_denied") summary.degraded++;
    if (result.outcome === "error") summary.failed++;
  }

  return summary;
}
