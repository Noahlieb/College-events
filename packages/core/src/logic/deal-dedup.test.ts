import { describe, expect, it } from "vitest";
import { classifyIncomingDeal, computeDealFingerprint, type DealFingerprintInput, type ExistingDealForDedup } from "./deal-dedup.js";

const tacoTuesday: DealFingerprintInput = {
  merchantId: "merchant-1",
  dealCategory: "food_restaurant",
  dealPrice: "$2",
  isBogo: false,
  isFreeItem: false,
  validDaysOfWeek: [2],
};

describe("computeDealFingerprint", () => {
  it("produces the same fingerprint for identical offers", () => {
    expect(computeDealFingerprint(tacoTuesday)).toBe(computeDealFingerprint({ ...tacoTuesday }));
  });

  it("produces a different fingerprint when the price changes", () => {
    expect(computeDealFingerprint(tacoTuesday)).not.toBe(computeDealFingerprint({ ...tacoTuesday, dealPrice: "$3" }));
  });

  it("produces a different fingerprint for a different merchant", () => {
    expect(computeDealFingerprint(tacoTuesday)).not.toBe(computeDealFingerprint({ ...tacoTuesday, merchantId: "merchant-2" }));
  });
});

describe("classifyIncomingDeal", () => {
  it("classifies a brand-new offer as new", () => {
    const result = classifyIncomingDeal(tacoTuesday, [], "2026-09-17");
    expect(result.status).toBe("new");
  });

  it("classifies an exact repeat of an unexpired deal as duplicate", () => {
    const existing: ExistingDealForDedup = {
      ...tacoTuesday,
      id: "deal-1",
      fingerprint: computeDealFingerprint(tacoTuesday),
      expirationDate: "2026-12-31",
    };
    const result = classifyIncomingDeal(tacoTuesday, [existing], "2026-09-17");
    expect(result).toEqual({ status: "duplicate", matchedDealId: "deal-1" });
  });

  it("classifies an exact repeat of an expired deal as existing_recurring", () => {
    const existing: ExistingDealForDedup = {
      ...tacoTuesday,
      id: "deal-1",
      fingerprint: computeDealFingerprint(tacoTuesday),
      expirationDate: "2026-01-01",
    };
    const result = classifyIncomingDeal(tacoTuesday, [existing], "2026-09-17");
    expect(result).toEqual({ status: "existing_recurring", matchedDealId: "deal-1" });
  });

  it("classifies the same offer slot with different price/terms as updated", () => {
    const existing: ExistingDealForDedup = {
      ...tacoTuesday,
      id: "deal-1",
      fingerprint: computeDealFingerprint(tacoTuesday),
      expirationDate: "2026-12-31",
    };
    const changed = { ...tacoTuesday, dealPrice: "$3" };
    const result = classifyIncomingDeal(changed, [existing], "2026-09-17");
    expect(result).toEqual({ status: "updated", matchedDealId: "deal-1" });
  });

  it("does not confuse a wholly different merchant's similar offer with an update", () => {
    const existing: ExistingDealForDedup = {
      ...tacoTuesday,
      id: "deal-1",
      fingerprint: computeDealFingerprint(tacoTuesday),
      expirationDate: "2026-12-31",
    };
    const otherMerchant = { ...tacoTuesday, merchantId: "merchant-9", dealPrice: "$3" };
    const result = classifyIncomingDeal(otherMerchant, [existing], "2026-09-17");
    expect(result.status).toBe("new");
  });
});
