import { describe, expect, it } from "vitest";
import {
  DEGRADED_MIN_BACKOFF_MINUTES,
  FAILURE_THRESHOLD,
  evaluateSourceHealth,
  isCrawlable,
  nextRunAfter,
} from "./source-health.js";

const base = { itemsSeen: 0, discovered: 0, hasYieldedBefore: false, consecutiveFailures: 0 };

describe("evaluateSourceHealth", () => {
  it("is healthy when the source returned events", () => {
    expect(evaluateSourceHealth({ ...base, itemsSeen: 12, discovered: 3 }).status).toBe("healthy");
  });

  it("warns when a source that used to yield events suddenly returns none", () => {
    // The quiet failure: nothing errors, the run looks clean, and coverage
    // shrinks. It has to be visible or nobody ever looks at it.
    const verdict = evaluateSourceHealth({ ...base, hasYieldedBefore: true });
    expect(verdict.status).toBe("warning");
    expect(verdict.reason).toMatch(/produced events before/);
  });

  it("does not warn about a source that has never yielded", () => {
    // An out-of-season athletics feed is legitimately empty; flagging it
    // would train operators to ignore the warning colour.
    expect(evaluateSourceHealth({ ...base, hasYieldedBefore: false }).status).toBe("healthy");
  });

  it("marks a platform that declined automated access as degraded, never failed", () => {
    // DEGRADED is the whole point: it is the platform's access control
    // working, not a defect, and the answer is never to retry harder.
    const verdict = evaluateSourceHealth({
      ...base,
      consecutiveFailures: 9,
      error: { kind: "access_denied", message: "served an anti-bot challenge" },
    });
    expect(verdict.status).toBe("degraded");
    expect(verdict.reason).toMatch(/challenge/);
  });

  it("keeps a degraded verdict no matter how many times access is refused", () => {
    for (const failures of [1, 3, 50]) {
      const verdict = evaluateSourceHealth({
        ...base,
        consecutiveFailures: failures,
        error: { kind: "access_denied", message: "HTTP 403" },
      });
      expect(verdict.status).toBe("degraded");
    }
  });

  it("warns on the first real errors, then fails at the threshold", () => {
    for (let i = 1; i < FAILURE_THRESHOLD; i++) {
      expect(
        evaluateSourceHealth({ ...base, consecutiveFailures: i, error: { kind: "error", message: "boom" } })
          .status,
      ).toBe("warning");
    }
    expect(
      evaluateSourceHealth({
        ...base,
        consecutiveFailures: FAILURE_THRESHOLD,
        error: { kind: "error", message: "boom" },
      }).status,
    ).toBe("failed");
  });

  it("always explains a non-healthy verdict", () => {
    // A red dot with no reason sends someone reading logs; the reason is
    // what makes source health actionable on the dashboard.
    const bad = [
      evaluateSourceHealth({ ...base, hasYieldedBefore: true }),
      evaluateSourceHealth({ ...base, error: { kind: "error", message: "boom" } }),
      evaluateSourceHealth({ ...base, error: { kind: "access_denied", message: "challenged" } }),
    ];
    for (const verdict of bad) expect(verdict.reason).toBeTruthy();
  });
});

describe("nextRunAfter", () => {
  const now = new Date("2026-08-25T08:00:00Z");

  it("uses the configured interval for a healthy source", () => {
    expect(nextRunAfter(now, 240, "healthy").toISOString()).toBe("2026-08-25T12:00:00.000Z");
  });

  it("backs a degraded source off well past its normal interval", () => {
    const next = nextRunAfter(now, 60, "degraded");
    const minutes = (next.getTime() - now.getTime()) / 60_000;
    expect(minutes).toBe(DEGRADED_MIN_BACKOFF_MINUTES);
  });

  it("never shortens the interval of a source that already crawls rarely", () => {
    const minutes = (nextRunAfter(now, 2000, "degraded").getTime() - now.getTime()) / 60_000;
    expect(minutes).toBe(2000);
  });
});

describe("isCrawlable", () => {
  it("keeps degraded and failed sources in the queue so they can recover", () => {
    expect(isCrawlable("degraded")).toBe(true);
    expect(isCrawlable("failed")).toBe(true);
  });

  it("excludes only deliberately disabled sources", () => {
    expect(isCrawlable("disabled")).toBe(false);
  });
});
