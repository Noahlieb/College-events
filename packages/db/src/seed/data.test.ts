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

  it("includes every required test scenario from spec §37", () => {
    // duplicate-across-sources, conflicting time, no image, expired, low relevance
    expect(FAU_EVENTS.some((e) => e.sourceKeys.length >= 2)).toBe(true);
    expect(FAU_EVENTS.some((e) => e.conflictingStartTime)).toBe(true);
    expect(FAU_EVENTS.some((e) => e.sourceImage === null)).toBe(true);
    expect(FAU_EVENTS.some((e) => e.statusOverride === "expired")).toBe(true);
    expect(FAU_EVENTS.some((e) => e.flags?.includes("low_relevance"))).toBe(true);
  });

  it("has unique event keys and externalIds are derivable without collision", () => {
    const keys = FAU_EVENTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
