import { describe, expect, it } from "vitest";
import { computeFreshnessStatus, isEvergreenDeal } from "./deal-freshness.js";

const today = "2026-09-17";

describe("computeFreshnessStatus", () => {
  it("returns expired for a past expiration date", () => {
    expect(
      computeFreshnessStatus({ dateDiscovered: "2026-09-01", recurring: false, expirationDate: "2026-09-10", today }),
    ).toBe("expired");
  });

  it("returns expiring_soon within the warning window", () => {
    expect(
      computeFreshnessStatus({ dateDiscovered: "2026-09-01", recurring: false, expirationDate: "2026-09-19", today }),
    ).toBe("expiring_soon");
  });

  it("returns updated when changed since last seen, even if recurring", () => {
    expect(
      computeFreshnessStatus({ dateDiscovered: "2026-01-01", recurring: true, changedSinceLastSeen: true, today }),
    ).toBe("updated");
  });

  it("returns recurring for a standing weekly special", () => {
    expect(computeFreshnessStatus({ dateDiscovered: "2026-01-01", recurring: true, today })).toBe("recurring");
  });

  it("returns new for something discovered within the last few days", () => {
    expect(computeFreshnessStatus({ dateDiscovered: "2026-09-16", recurring: false, today })).toBe("new");
  });

  it("returns active for an older one-time deal with a known window", () => {
    expect(
      computeFreshnessStatus({
        dateDiscovered: "2026-08-01",
        recurring: false,
        startDate: "2026-08-01",
        expirationDate: "2026-12-01",
        today,
      }),
    ).toBe("active");
  });

  it("returns unknown when there is no date signal at all", () => {
    expect(computeFreshnessStatus({ dateDiscovered: "2026-08-01", recurring: false, today })).toBe("unknown");
  });
});

describe("isEvergreenDeal", () => {
  it("treats a permanent student-ID discount as evergreen", () => {
    expect(isEvergreenDeal({ recurring: false, studentIdRequired: true, isBogo: false, isFreeItem: false })).toBe(true);
  });

  it("does not treat a dated or BOGO/free offer as evergreen", () => {
    expect(
      isEvergreenDeal({ recurring: false, studentIdRequired: true, isBogo: true, isFreeItem: false }),
    ).toBe(false);
    expect(
      isEvergreenDeal({
        recurring: false,
        studentIdRequired: true,
        isBogo: false,
        isFreeItem: false,
        expirationDate: "2026-12-01",
      }),
    ).toBe(false);
  });
});
