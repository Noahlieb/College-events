import { describe, expect, it } from "vitest";
import { MockAIProvider } from "./mock.js";
import { ExtractedDealSchema } from "../schemas.js";

const provider = new MockAIProvider();
const universityContext = { name: "University of Central Florida", shortName: "UCF", city: "Orlando", state: "FL", timezone: "America/New_York" };

describe("MockAIProvider.extractDeal", () => {
  it("extracts a $6 Taco Tuesday-style recurring deal", async () => {
    const result = await provider.extractDeal({
      universityContext,
      merchantName: "Knights Tacos",
      merchantCategory: "restaurant",
      sourceType: "promotions_page",
      sourceUrl: null,
      rawText: "Taco Tuesday every Tuesday — tacos for just $2 each, dine-in or takeout.",
      currentDate: "2026-09-17",
    });
    expect(result.is_deal).toBe(true);
    expect(result.deal_price).toBe("$2");
    expect(result.valid_days_of_week).toEqual([2]);
    expect(result.recurring).toBe(true);
    expect(ExtractedDealSchema.safeParse(result).success).toBe(true);
  });

  it("extracts a BOGO offer", async () => {
    const result = await provider.extractDeal({
      universityContext,
      merchantName: "Knight Bowls",
      merchantCategory: "fast_casual",
      sourceType: "menu_page",
      sourceUrl: null,
      rawText: "BOGO bowls every Wednesday, buy one get one free with any drink purchase.",
      currentDate: "2026-09-17",
    });
    expect(result.is_deal).toBe(true);
    expect(result.is_bogo).toBe(true);
    expect(result.valid_days_of_week).toContain(3);
  });

  it("extracts a permanent student-ID discount without inventing an expiration", async () => {
    const result = await provider.extractDeal({
      universityContext,
      merchantName: "Campus Cuts",
      merchantCategory: "barber",
      sourceType: "official_website",
      sourceUrl: null,
      rawText: "10% off any service with valid student ID.",
      currentDate: "2026-09-17",
    });
    expect(result.is_deal).toBe(true);
    expect(result.discount_percent).toBe(10);
    expect(result.student_id_required).toBe(true);
    expect(result.expiration_date).toBeNull();
  });

  it("does not hallucinate a deal from a plain menu with no promo", async () => {
    const result = await provider.extractDeal({
      universityContext,
      merchantName: "Knight Tacos",
      merchantCategory: "restaurant",
      sourceType: "menu_page",
      sourceUrl: null,
      rawText: "Our menu features tacos, burritos, and quesadillas made fresh daily.",
      currentDate: "2026-09-17",
    });
    expect(result.is_deal).toBe(false);
    expect(result.deal_price).toBeNull();
  });
});
