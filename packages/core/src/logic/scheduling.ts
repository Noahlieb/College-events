/**
 * Crawl scheduling and failure isolation.
 *
 * Kept as pure functions so the two properties that matter most can be
 * tested without a database or a network: that one source's failure never
 * touches another's, and that the queue order is the one we intended.
 */

export interface SchedulableSource {
  id: string;
  active: boolean;
  healthStatus: string;
  crawlPriority: number;
  nextRunAt: Date | null;
}

/**
 * Sources due for a crawl, highest priority first.
 *
 * A source with no `nextRunAt` has never been scheduled and is due
 * immediately — that is how a newly-approved source gets crawled without
 * waiting a cycle. Disabled sources are excluded; degraded and failed ones
 * are not, because they need a chance to recover and their back-off is
 * already expressed in `nextRunAt`.
 */
export function selectDueSources<T extends SchedulableSource>(
  sources: T[],
  now: Date,
  limit?: number,
): T[] {
  const due = sources
    .filter((s) => s.active && s.healthStatus !== "disabled")
    .filter((s) => s.nextRunAt === null || s.nextRunAt.getTime() <= now.getTime())
    .sort((a, b) => {
      if (b.crawlPriority !== a.crawlPriority) return b.crawlPriority - a.crawlPriority;
      // Among equals, the one waiting longest goes first, so a low-priority
      // source can never be starved indefinitely by busier neighbours.
      const aTime = a.nextRunAt?.getTime() ?? 0;
      const bTime = b.nextRunAt?.getTime() ?? 0;
      return aTime - bTime;
    });

  return limit != null ? due.slice(0, limit) : due;
}

export interface SettledResult<T> {
  index: number;
  status: "fulfilled" | "rejected";
  value?: T;
  error?: unknown;
}

/**
 * Runs tasks with a concurrency cap, isolating every failure.
 *
 * The contract is the important part: this never rejects. One source
 * throwing must not stop the other nineteen, and a run that dies partway
 * leaves a university with a half-built week for reasons that have nothing
 * to do with its own sources. Every task's outcome is reported, in input
 * order, whether it succeeded or threw.
 */
export async function runIsolated<T>(
  tasks: (() => Promise<T>)[],
  concurrency = 4,
): Promise<SettledResult<T>[]> {
  const results: SettledResult<T>[] = new Array(tasks.length);
  const limit = Math.max(1, Math.min(concurrency, tasks.length || 1));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        results[index] = { index, status: "fulfilled", value: await tasks[index]!() };
      } catch (error) {
        results[index] = { index, status: "rejected", error };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * Average events per run, used to spot a source whose yield has collapsed.
 * Returns null below `minRuns`, because two data points is not a trend and
 * flagging on them would train operators to ignore the signal.
 */
export function averageYield(recentRunYields: number[], minRuns = 3): number | null {
  if (recentRunYields.length < minRuns) return null;
  return recentRunYields.reduce((sum, n) => sum + n, 0) / recentRunYields.length;
}

/**
 * Whether a source's recent runs look like a silent failure: it used to
 * produce events and has now returned nothing several times running.
 */
export function hasYieldCollapsed(recentRunYields: number[], consecutiveZerosAllowed = 2): boolean {
  if (recentRunYields.length <= consecutiveZerosAllowed) return false;
  const trailing = recentRunYields.slice(-(consecutiveZerosAllowed + 1));
  if (!trailing.every((n) => n === 0)) return false;
  // Only a collapse if there was something to collapse from.
  return recentRunYields.slice(0, -(consecutiveZerosAllowed + 1)).some((n) => n > 0);
}
