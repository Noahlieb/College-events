import { describe, expect, it } from "vitest";
import { ADAPTER_TYPES } from "@college-events/core";
import { FAU_ENTITIES, FAU_SCHOOL, FAU_SOURCES, SECONDARY_SOURCE_KEYS } from "./data.js";

/**
 * Guards the FAU migration into the multi-university model. FAU is the
 * first university record, not a special case — so every assertion here is
 * one that must also hold for the second and hundredth university.
 */
describe("university model", () => {
  it("carries the fields the discovery engine needs", () => {
    // primary_domain anchors `site:` queries; without it a university can
    // be created but never discovered against.
    expect(FAU_SCHOOL.primaryDomain).toBe("fau.edu");
    expect(FAU_SCHOOL.city).toBeTruthy();
    expect(FAU_SCHOOL.state).toBeTruthy();
    expect(FAU_SCHOOL.timezone).toBeTruthy();
    expect(typeof FAU_SCHOOL.latitude).toBe("number");
    expect(typeof FAU_SCHOOL.longitude).toBe("number");
  });

  it("states a primary domain without a scheme or path", () => {
    // Queries are built as `site:{domain}`, which breaks on a full URL.
    expect(FAU_SCHOOL.primaryDomain).not.toMatch(/^https?:/);
    expect(FAU_SCHOOL.primaryDomain).not.toContain("/");
  });
});

describe("FAU source migration", () => {
  it("gives every source a real adapter type", () => {
    for (const s of FAU_SOURCES) {
      expect(ADAPTER_TYPES, `source "${s.key}" has unknown adapter`).toContain(s.adapterType);
    }
  });

  it("preserves every source that existed before the refactor", () => {
    // Inactive sources are parked, not deleted — Culture Room, The Wharf,
    // Revolution Live and Visit Lauderdale must survive the migration so
    // they stay one click from being re-enabled.
    const keys = new Set(FAU_SOURCES.map((s) => s.key));
    for (const key of [
      "fau_athletics",
      "owl_central_csv",
      "posh_vip",
      "owl_central",
      "culture_room",
      "wharf_ftl",
      "revolution_live",
      "visit_lauderdale",
      "fau_sg_ig",
      "fau_union_ig",
      "sofla_nightlife_ig",
      "manual_entry",
    ]) {
      expect(keys.has(key), `source "${key}" was dropped by the migration`).toBe(true);
    }
  });

  it("keeps the three live sources active", () => {
    for (const key of ["fau_athletics", "owl_central_csv", "posh_vip"]) {
      const source = FAU_SOURCES.find((s) => s.key === key)!;
      expect(source.active ?? true, `"${key}" must stay active`).toBe(true);
    }
  });

  it("routes athletics through the reusable sidearm adapter", () => {
    const athletics = FAU_SOURCES.find((s) => s.key === "fau_athletics")!;
    expect(athletics.adapterType).toBe("sidearm");
    // Everything school-specific is the URL, not the adapter — the same
    // adapter serves any SIDEARM-powered athletics site.
    expect(athletics.url).toBe("https://fausports.com");
  });

  it("crawls Owl Central directly instead of through a CSV round trip", () => {
    // Automated ingestion used to depend on a Python cron writing a CSV
    // somewhere. The platform is now read through the reusable adapter,
    // with the host as the only school-specific fact.
    const owl = FAU_SOURCES.find((s) => s.key === "owl_central_csv")!;
    expect(owl.adapterType).toBe("campuslabs");
    expect(owl.config?.host).toBe("fau.campuslabs.com");
    expect(owl.sourceType).not.toBe("manual_submission");
    // A crawl interval of 0 meant "never polled, fed externally".
    expect(owl.scrapeFrequencyMinutes).toBeGreaterThan(0);
  });

  it("keeps the CampusLabs host in config, never in the adapter name", () => {
    // Rule 2: the same adapter has to serve the next campus unchanged.
    for (const s of FAU_SOURCES.filter((s) => s.adapterType === "campuslabs")) {
      expect(s.config?.host).toBeTruthy();
    }
  });

  it("keeps a manual source for admin CSV uploads to attach to", () => {
    // CSV survives as an operator tool; it is just no longer the
    // automated integration boundary.
    const manual = FAU_SOURCES.filter((s) => s.sourceType === "manual_submission");
    expect(manual.length).toBeGreaterThan(0);
  });

  it("routes the nightlife listing through the posh adapter", () => {
    const posh = FAU_SOURCES.find((s) => s.key === "posh_vip")!;
    expect(posh.adapterType).toBe("posh");
    expect(posh.forceCategory).toBe("nightlife");
  });

  it("never scrapes social platforms directly", () => {
    // Instagram sources must resolve to the push-fed connector, so the
    // crawler has no path that would hit the platform itself.
    for (const s of FAU_SOURCES.filter((s) => s.sourceType === "instagram")) {
      expect(s.adapterType).toBe("external_social");
    }
  });

  it("keeps trust and crawl priority separable per source", () => {
    // They default to the old single `priority`, but the type must allow
    // them to diverge — that is the point of splitting the column.
    for (const s of FAU_SOURCES) {
      const trust = s.trustScore ?? s.priority;
      const crawl = s.crawlPriority ?? s.priority;
      expect(typeof trust).toBe("number");
      expect(typeof crawl).toBe("number");
    }
  });
});

describe("entity graph", () => {
  const sourceKeys = new Set(FAU_SOURCES.map((s) => s.key));

  it("links every entity to sources that actually exist", () => {
    for (const e of FAU_ENTITIES) {
      for (const key of e.sourceKeys ?? []) {
        expect(sourceKeys.has(key), `entity "${e.key}" references unknown source "${key}"`).toBe(true);
      }
    }
  });

  it("gives the venue sources a venue to belong to", () => {
    // The four venue rows kept from the pre-refactor seed are exactly the
    // ones that need an entity — they are real places with several possible
    // channels each.
    for (const key of ["culture_room", "wharf_ftl", "revolution_live"]) {
      const owner = FAU_ENTITIES.find((e) => (e.sourceKeys ?? []).includes(key));
      expect(owner, `no entity owns source "${key}"`).toBeDefined();
      expect(owner!.entityType).toBe("venue");
    }
  });

  it("treats a tourism calendar as a secondary source, not a venue", () => {
    // It reports on many venues without being any of them, so it must not
    // speak for them when flyers are compared.
    expect(SECONDARY_SOURCE_KEYS.has("visit_lauderdale")).toBe(true);
    const owner = FAU_ENTITIES.find((e) => (e.sourceKeys ?? []).includes("visit_lauderdale"))!;
    expect(owner.entityType).not.toBe("venue");
  });

  it("keeps the social watchlist entities identified by handle", () => {
    // A shared handle is what later proves an Instagram source and a
    // website belong to the same organization.
    for (const key of ["fau_sg_ig", "fau_union_ig", "sofla_nightlife_ig"]) {
      const owner = FAU_ENTITIES.find((e) => (e.sourceKeys ?? []).includes(key))!;
      expect(owner.instagramHandle, `entity for "${key}" has no handle`).toBeTruthy();
    }
  });

  it("never assigns one source to two entities", () => {
    // The denormalized sources.entity_id can only hold one owner, so a
    // source claimed twice would silently lose one of them.
    const seen = new Set<string>();
    for (const e of FAU_ENTITIES) {
      for (const key of e.sourceKeys ?? []) {
        expect(seen.has(key), `source "${key}" is claimed by two entities`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("has no duplicate entity keys", () => {
    expect(new Set(FAU_ENTITIES.map((e) => e.key)).size).toBe(FAU_ENTITIES.length);
  });
});
