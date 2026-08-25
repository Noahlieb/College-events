import { describe, expect, it } from "vitest";
import {
  averageYield,
  hasYieldCollapsed,
  runIsolated,
  selectDueSources,
  type SchedulableSource,
} from "./scheduling.js";

const src = (overrides: Partial<SchedulableSource> & { id: string }): SchedulableSource => ({
  active: true,
  healthStatus: "healthy",
  crawlPriority: 5,
  nextRunAt: null,
  ...overrides,
});

const NOW = new Date("2026-08-25T12:00:00Z");
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000);
const ahead = (mins: number) => new Date(NOW.getTime() + mins * 60_000);

describe("selectDueSources", () => {
  it("treats a never-scheduled source as due immediately", () => {
    // A newly approved source should not wait a cycle before its first crawl.
    expect(selectDueSources([src({ id: "new" })], NOW).map((s) => s.id)).toEqual(["new"]);
  });

  it("excludes sources not yet due", () => {
    expect(selectDueSources([src({ id: "later", nextRunAt: ahead(30) })], NOW)).toEqual([]);
  });

  it("excludes disabled sources", () => {
    expect(selectDueSources([src({ id: "off", active: false })], NOW)).toEqual([]);
    expect(selectDueSources([src({ id: "dis", healthStatus: "disabled" })], NOW)).toEqual([]);
  });

  it("keeps degraded and failed sources in the queue so they can recover", () => {
    // Their back-off is already expressed in nextRunAt; dropping them
    // entirely would mean a source never comes back on its own.
    const due = selectDueSources(
      [src({ id: "deg", healthStatus: "degraded", nextRunAt: ago(5) }), src({ id: "fail", healthStatus: "failed", nextRunAt: ago(5) })],
      NOW,
    );
    expect(due.map((s) => s.id).sort()).toEqual(["deg", "fail"]);
  });

  it("orders by crawl priority", () => {
    const due = selectDueSources(
      [src({ id: "low", crawlPriority: 2 }), src({ id: "high", crawlPriority: 9 }), src({ id: "mid", crawlPriority: 5 })],
      NOW,
    );
    expect(due.map((s) => s.id)).toEqual(["high", "mid", "low"]);
  });

  it("does not starve a low-priority source that has waited longest", () => {
    const due = selectDueSources(
      [src({ id: "recent", crawlPriority: 5, nextRunAt: ago(1) }), src({ id: "stale", crawlPriority: 5, nextRunAt: ago(600) })],
      NOW,
    );
    expect(due[0]!.id).toBe("stale");
  });

  it("respects a batch limit", () => {
    const sources = Array.from({ length: 10 }, (_, i) => src({ id: `s${i}` }));
    expect(selectDueSources(sources, NOW, 3)).toHaveLength(3);
  });
});

describe("runIsolated", () => {
  it("never rejects, whatever the tasks do", async () => {
    // The contract: one source's failure must not stop the rest, and a
    // half-finished run leaves a university with a half-built week.
    const results = await runIsolated([
      async () => "ok",
      async () => {
        throw new Error("boom");
      },
      async () => "also ok",
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("runs every task even when the first one throws", async () => {
    const ran: number[] = [];
    await runIsolated([
      async () => {
        ran.push(0);
        throw new Error("first fails");
      },
      async () => {
        ran.push(1);
      },
      async () => {
        ran.push(2);
      },
    ]);
    expect(ran.sort()).toEqual([0, 1, 2]);
  });

  it("reports results in input order regardless of finishing order", async () => {
    const results = await runIsolated([
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "slow";
      },
      async () => "fast",
    ]);
    expect(results[0]!.value).toBe("slow");
    expect(results[1]!.value).toBe("fast");
  });

  it("carries the original error for logging", async () => {
    const results = await runIsolated([
      async () => {
        throw new Error("rate limited");
      },
    ]);
    expect((results[0]!.error as Error).message).toBe("rate limited");
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, () => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    await runIsolated(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty task list", async () => {
    expect(await runIsolated([])).toEqual([]);
  });
});

describe("yield monitoring", () => {
  it("refuses to call a trend from too few runs", () => {
    // Two data points is not a trend, and flagging on them trains people
    // to ignore the warning.
    expect(averageYield([0, 0])).toBeNull();
    expect(averageYield([4, 6, 5])).toBe(5);
  });

  it("spots a source that used to yield and has now gone quiet", () => {
    expect(hasYieldCollapsed([7, 5, 6, 0, 0, 0])).toBe(true);
  });

  it("does not flag a source that has never yielded", () => {
    // An out-of-season athletics feed is legitimately empty.
    expect(hasYieldCollapsed([0, 0, 0, 0])).toBe(false);
  });

  it("does not flag a single quiet run", () => {
    expect(hasYieldCollapsed([5, 4, 6, 0])).toBe(false);
  });

  it("clears once the source produces again", () => {
    expect(hasYieldCollapsed([5, 0, 0, 0, 3])).toBe(false);
  });
});
