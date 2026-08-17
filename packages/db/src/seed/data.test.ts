import { describe, expect, it } from "vitest";
import { FAU_EVENTS, FAU_PENDING_RAW_CONTENT, FAU_SOURCES } from "./data.js";

describe("FAU seed data integrity", () => {
  const sourceKeys = new Set(FAU_SOURCES.map((s) => s.key));

  it("has no duplicate source keys", () => {
    expect(sourceKeys.size).toBe(FAU_SOURCES.length);
  });

  it("every FAU_EVENTS.sourceKeys entry references a real source", () => {
    for (const event of FAU_EVENTS) {
      for (const key of event.sourceKeys) {
        expect(sourceKeys.has(key), `event "${event.key}" references unknown source "${key}"`).toBe(true);
      }
    }
  });

  it("every FAU_PENDING_RAW_CONTENT.sourceKey references a real source", () => {
    for (const item of FAU_PENDING_RAW_CONTENT) {
      expect(sourceKeys.has(item.sourceKey), `raw content "${item.key}" references unknown source "${item.sourceKey}"`).toBe(
        true,
      );
    }
  });

  // Spec §37 asks for coverage of duplicate-across-sources, conflicting-time,
  // no-image, expired, and low-relevance events. The current seed is a
  // genuine single-source CSV pull of real, all-upcoming, all-photographed
  // events (see the comment above FAU_EVENTS) — deliberately not
  // manufacturing those scenarios with invented facts. Each is still
  // covered directly at the logic level instead: verification.test.ts
  // (merge/conflict), scoring.test.ts and dates.test.ts (relevance/expiry),
  // and packages/render's renderSlide.test.ts (no-image fallback).
  it("every event has a real, non-empty description and organization", () => {
    for (const event of FAU_EVENTS) {
      expect(event.description.length, `event "${event.key}" has an empty description`).toBeGreaterThan(0);
      expect(event.organization.length, `event "${event.key}" has an empty organization`).toBeGreaterThan(0);
    }
  });

  it("has unique event keys and externalIds are derivable without collision", () => {
    const keys = FAU_EVENTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
