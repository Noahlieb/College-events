import { and, desc, eq, inArray, lte, or, isNull } from "drizzle-orm";
import { crawlJobs, db, sourceRuns, sources } from "@college-events/db";
import { runIsolated, selectDueSources } from "@college-events/core";
import { runSource, type SourceRunResult } from "./ingest.js";
import { log } from "../lib/log.js";

/**
 * The scheduler: find what's due, queue it, run it, record what happened.
 *
 * This replaces "one nightly script walks every source in order". That
 * shape works for three sources and fails for three thousand: one slow or
 * hostile platform holds up everything behind it, and every source shares
 * one interval whether it needs it or not. Here the unit of work is a
 * single source's crawl, and failures are contained to their own job.
 */

export interface SchedulerSummary {
  enqueued: number;
  ran: number;
  succeeded: number;
  failed: number;
  degraded: number;
  results: SourceRunResult[];
}

/**
 * A job sitting "queued" or "running" this long is treated as abandoned
 * rather than merely slow — the worker process that owned it crashed, was
 * interrupted (Ctrl+C), or the container restarted mid-run. Without this, an
 * interrupted crawl leaves its jobs stuck open forever, which — because of
 * the busy check below — permanently blocks their sources from ever being
 * re-queued. Fifteen minutes is generous next to the per-request fetch
 * timeout in `runSource`, which bounds any one source's real run time.
 */
const STALE_JOB_MINUTES = 15;

/**
 * Closes out jobs abandoned by a worker that never got to finish them, so
 * their sources are eligible to be queued again instead of looking "busy"
 * indefinitely. Returns how many were reaped.
 */
export async function reapStaleJobs(schoolId: string, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_JOB_MINUTES * 60_000);
  const reaped = await db
    .update(crawlJobs)
    .set({
      status: "failed",
      finishedAt: now,
      lastError: `Abandoned — no result recorded within ${STALE_JOB_MINUTES} minutes; the worker that owned this job likely crashed or was interrupted.`,
    })
    .where(
      and(
        eq(crawlJobs.schoolId, schoolId),
        or(
          and(eq(crawlJobs.status, "running"), lte(crawlJobs.startedAt, cutoff)),
          and(eq(crawlJobs.status, "queued"), lte(crawlJobs.createdAt, cutoff)),
        ),
      ),
    )
    .returning({ id: crawlJobs.id });
  return reaped.length;
}

/**
 * Queues every source whose `next_run_at` has passed.
 *
 * A source already carrying a queued or running job is skipped — otherwise
 * a scheduler tick that overlaps a slow run would stack duplicate jobs for
 * the same source and crawl it twice concurrently. Stale jobs are reaped
 * first so a run interrupted on a previous tick doesn't count as "busy"
 * forever.
 */
export async function enqueueDueSources(
  schoolId: string,
  now = new Date(),
  limit?: number,
): Promise<number> {
  await reapStaleJobs(schoolId, now);

  const candidates = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.schoolId, schoolId),
        eq(sources.active, true),
        or(isNull(sources.nextRunAt), lte(sources.nextRunAt, now)),
      ),
    );

  const due = selectDueSources(
    candidates.map((s) => ({
      id: s.id,
      active: s.active,
      healthStatus: s.healthStatus,
      crawlPriority: s.crawlPriority,
      nextRunAt: s.nextRunAt,
    })),
    now,
    limit,
  );
  if (due.length === 0) return 0;

  const dueIds = due.map((d) => d.id);
  const inFlight = await db
    .select({ sourceId: crawlJobs.sourceId })
    .from(crawlJobs)
    .where(and(inArray(crawlJobs.sourceId, dueIds), inArray(crawlJobs.status, ["queued", "running"])));
  const busy = new Set(inFlight.map((j) => j.sourceId));

  const toQueue = due.filter((d) => !busy.has(d.id));
  if (toQueue.length === 0) return 0;

  await db.insert(crawlJobs).values(
    toQueue.map((d) => ({
      schoolId,
      sourceId: d.id,
      status: "queued" as const,
      priority: d.crawlPriority,
      scheduledFor: now,
    })),
  );
  return toQueue.length;
}

/**
 * Claims and runs queued jobs, up to `concurrency` at a time.
 *
 * Every job is isolated: a source that throws, hangs on a bad response, or
 * declines automated access marks its own job and leaves the rest alone.
 * The whole point of the change is that no single source can cost a
 * university its day's events.
 */
export async function runQueuedJobs(
  schoolId: string,
  options: { concurrency?: number; maxJobs?: number; maxItemsPerSource?: number; now?: Date } = {},
): Promise<SchedulerSummary> {
  const now = options.now ?? new Date();
  const concurrency = options.concurrency ?? 4;

  const queued = await db
    .select({ job: crawlJobs, source: sources })
    .from(crawlJobs)
    .innerJoin(sources, eq(crawlJobs.sourceId, sources.id))
    .where(and(eq(crawlJobs.schoolId, schoolId), eq(crawlJobs.status, "queued")))
    .orderBy(desc(crawlJobs.priority))
    .limit(options.maxJobs ?? 50);

  const summary: SchedulerSummary = {
    enqueued: 0,
    ran: 0,
    succeeded: 0,
    failed: 0,
    degraded: 0,
    results: [],
  };
  if (queued.length === 0) return summary;

  const settled = await runIsolated(
    queued.map(({ job, source }) => async () => {
      const startedAt = new Date();
      await db
        .update(crawlJobs)
        .set({ status: "running", startedAt, attempts: job.attempts + 1 })
        .where(eq(crawlJobs.id, job.id));

      // runSource already contains its own failures; this catch is for the
      // genuinely unexpected — a bug in the pipeline rather than in a
      // source — so that even then the job is closed out rather than left
      // stuck in `running` forever.
      let result: SourceRunResult;
      try {
        result = await runSource(source, { maxItems: options.maxItemsPerSource ?? 50, now });
      } catch (err) {
        await db
          .update(crawlJobs)
          .set({ status: "failed", finishedAt: new Date(), lastError: (err as Error).message })
          .where(eq(crawlJobs.id, job.id));
        await db.insert(sourceRuns).values({
          sourceId: source.id,
          jobId: job.id,
          startedAt,
          finishedAt: new Date(),
          outcome: "error",
          errorMessage: (err as Error).message,
        });
        throw err;
      }

      await db.insert(sourceRuns).values({
        sourceId: source.id,
        jobId: job.id,
        startedAt,
        finishedAt: new Date(),
        outcome: result.outcome,
        itemsSeen: result.itemsSeen,
        discovered: result.discovered,
        duplicatesSkipped: result.duplicatesSkipped,
        errorMessage: result.outcome === "ok" ? null : (result.reason ?? null),
        healthAfter: result.health,
      });

      await db
        .update(crawlJobs)
        .set({
          // A platform declining automated access is a completed job with a
          // degraded source, not a failed job — nothing here needs retrying.
          status: result.outcome === "error" ? "failed" : "succeeded",
          finishedAt: new Date(),
          lastError: result.outcome === "error" ? (result.reason ?? null) : null,
        })
        .where(eq(crawlJobs.id, job.id));

      return result;
    }),
    concurrency,
  );

  for (const outcome of settled) {
    summary.ran++;
    if (outcome.status === "rejected") {
      summary.failed++;
      await log(schoolId, "error", "crawl", `Crawl job crashed: ${(outcome.error as Error).message}`);
      continue;
    }
    const result = outcome.value!;
    summary.results.push(result);
    if (result.outcome === "error") summary.failed++;
    else if (result.outcome === "access_denied") summary.degraded++;
    else summary.succeeded++;
  }

  return summary;
}

/** Enqueue what's due, then work the queue. */
export async function tickScheduler(
  schoolId: string,
  options: { concurrency?: number; maxJobs?: number; now?: Date } = {},
): Promise<SchedulerSummary> {
  const enqueued = await enqueueDueSources(schoolId, options.now ?? new Date(), options.maxJobs);
  const summary = await runQueuedJobs(schoolId, options);
  return { ...summary, enqueued };
}

/**
 * Recent per-run yields for a source, newest last — the evidence behind a
 * "this source has gone quiet" warning.
 */
export async function recentYields(sourceId: string, limit = 6): Promise<number[]> {
  const rows = await db
    .select({ discovered: sourceRuns.discovered })
    .from(sourceRuns)
    .where(eq(sourceRuns.sourceId, sourceId))
    .orderBy(desc(sourceRuns.startedAt))
    .limit(limit);
  return rows.map((r) => r.discovered).reverse();
}
