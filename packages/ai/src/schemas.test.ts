import { describe, expect, it } from "vitest";
import { ExtractedEventSchema } from "./schemas.js";

describe("ExtractedEventSchema", () => {
  it("accepts a fully-null non-event result", () => {
    const result = ExtractedEventSchema.safeParse({
      is_event: false,
      event_name: null,
      date: null,
      start_time: null,
      end_time: null,
      venue: null,
      city: null,
      price: null,
      age_requirement: null,
      category: null,
      organization: null,
      description: null,
      confidence: 0.1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed date string instead of silently coercing it", () => {
    const result = ExtractedEventSchema.safeParse({
      is_event: true,
      event_name: "Test",
      date: "08/21/2026",
      start_time: null,
      end_time: null,
      venue: null,
      city: null,
      price: null,
      age_requirement: null,
      category: "campus",
      organization: null,
      description: null,
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a category outside the fixed enum", () => {
    const result = ExtractedEventSchema.safeParse({
      is_event: true,
      event_name: "Test",
      date: "2026-08-21",
      start_time: "19:00",
      end_time: null,
      venue: null,
      city: null,
      price: null,
      age_requirement: null,
      category: "made_up_category",
      organization: null,
      description: null,
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence values outside 0..1", () => {
    const result = ExtractedEventSchema.safeParse({
      is_event: true,
      event_name: "Test",
      date: "2026-08-21",
      start_time: null,
      end_time: null,
      venue: null,
      city: null,
      price: null,
      age_requirement: null,
      category: null,
      organization: null,
      description: null,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
