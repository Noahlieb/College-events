import { describe, expect, it } from "vitest";
import { scoreDeal, type DealScoreFactors } from "./deal-scoring.js";

const UCF_CAMPUS = { latitude: 28.6024, longitude: -81.2001 };

const base: DealScoreFactors = {
  dealCategory: "food_restaurant",
  merchantLatitude: UCF_CAMPUS.latitude,
  merchantLongitude: UCF_CAMPUS.longitude,
  campusLatitude: UCF_CAMPUS.latitude,
  campusLongitude: UCF_CAMPUS.longitude,
  isBogo: false,
  isFreeItem: false,
  studentIdRequired: false,
  freshnessStatus: "new",
  merchantStudentRelevanceScore: 80,
};

describe("scoreDeal", () => {
  it("scores a free meal near campus today very high", () => {
    const { overall } = scoreDeal({ ...base, isFreeItem: true, freshnessStatus: "new" });
    expect(overall).toBeGreaterThan(85);
  });

  it("scores a BOGO deal near campus very high", () => {
    const { overall } = scoreDeal({ ...base, isBogo: true });
    expect(overall).toBeGreaterThan(75);
  });

  it("ranks a $6 Taco Tuesday-style deal above a vague permanent 10% student discount", () => {
    const tacoTuesday = scoreDeal({ ...base, dealPrice: "$6", freshnessStatus: "recurring" });
    const permanentDiscount = scoreDeal({
      ...base,
      studentIdRequired: true,
      freshnessStatus: "unknown",
      dealCategory: "retail_services",
      merchantStudentRelevanceScore: 50,
    });
    expect(tacoTuesday.overall).toBeGreaterThan(permanentDiscount.overall);
  });

  it("penalizes a merchant far from campus relative to one 0.5mi away", () => {
    const near = scoreDeal({ ...base, isBogo: true });
    const far = scoreDeal({ ...base, isBogo: true, merchantLatitude: 28.42, merchantLongitude: -81.31 }); // ~13mi away
    expect(far.overall).toBeLessThan(near.overall);
  });

  it("scores an obscure low-value discount low", () => {
    const { overall } = scoreDeal({
      ...base,
      dealCategory: "other",
      discountPercent: 5,
      freshnessStatus: "unknown",
      merchantStudentRelevanceScore: 30,
    });
    expect(overall).toBeLessThan(50);
  });

  it("respects custom weights", () => {
    const withDefault = scoreDeal({ ...base, isFreeItem: true });
    const proximityOnly = scoreDeal(
      { ...base, isFreeItem: true, merchantLatitude: 28.42, merchantLongitude: -81.31 },
      { studentUsefulness: 0, savingsValue: 0, proximity: 1, freshnessUrgency: 0, shareability: 0, merchantRelevance: 0 },
    );
    expect(proximityOnly.overall).toBeLessThan(withDefault.overall);
  });
});
