import { describe, it, expect } from "vitest";
import { ADAPTER_TYPES, type AdapterType } from "@college-events/core";
import {
  adapterFor,
  adapterForSourceType,
  fromLegacyAdapter,
  registerAdapter,
  registeredAdapterTypes,
} from "./registry.js";
import type { EventSourceAdapter, SourceInstance } from "./adapter.js";
import type { SourceAdapter } from "./types.js";

function makeSource(overrides: Partial<SourceInstance> = {}): SourceInstance {
  return {
    id: "src-1",
    schoolId: "school-1",
    name: "Test Source",
    adapterType: "ical",
    url: "https://example.edu/events",
    discoveryUrl: null,
    instagramHandle: null,
    config: {},
    metadata: {},
    categoryBias: null,
    lastSuccessfulCheckAt: null,
    lastEventFoundAt: null,
    ...overrides,
  };
}

describe("adapter registry", () => {
  it("resolves adapters by platform, not by school", () => {
    // The same registry entry has to serve every university on that
    // platform — that is the whole point of splitting adapter from source.
    const a = adapterFor("sidearm");
    expect(a).not.toBeNull();
    expect(a!.type).toBe("sidearm");
  });

  it("returns null only for inputs that are deliberately not crawled", () => {
    // external_social is push-fed by an authorized connector and manual is
    // hand entry — neither should ever gain a crawler.
    expect(adapterFor("external_social")).toBeNull();
    expect(adapterFor("manual")).toBeNull();
  });

  it("covers every platform the fingerprinter can identify", () => {
    // A platform we can name but cannot read is a real state, but it
    // should be a deliberate one — this test is what makes adding a
    // fingerprint rule without an adapter a visible decision.
    const unsupported = (ADAPTER_TYPES as readonly AdapterType[]).filter((t) => adapterFor(t) === null);
    expect(unsupported.sort()).toEqual(["external_social", "manual"]);
  });

  it("declares capabilities for every registered adapter", () => {
    for (const type of registeredAdapterTypes()) {
      const adapter = adapterFor(type)!;
      expect(adapter.capabilities.discovery).toBe(true);
      expect(typeof adapter.capabilities.details).toBe("boolean");
      expect(typeof adapter.capabilities.assets).toBe("boolean");
      expect(typeof adapter.capabilities.incremental).toBe("boolean");
    }
  });

  it("only registers types that exist in the shared enum", () => {
    for (const type of registeredAdapterTypes()) {
      expect(ADAPTER_TYPES).toContain(type);
    }
  });

  it("registerAdapter replaces an existing type", () => {
    const original = adapterFor("rss")!;
    const stub: EventSourceAdapter = {
      type: "rss",
      capabilities: { discovery: true, details: false, assets: false, incremental: false },
      async discover() {
        return [];
      },
    };
    registerAdapter(stub);
    expect(adapterFor("rss")).toBe(stub);
    registerAdapter(original); // restore for other tests
    expect(adapterFor("rss")).toBe(original);
  });
});

describe("legacy adapter bridge", () => {
  it("passes discoveryUrl to legacy adapters in preference to url", async () => {
    // A source can list its public page in `url` while crawling starts at a
    // feed/API in `discoveryUrl`; the legacy shape only has one slot.
    let seenUrl: string | null = null;
    const legacy: SourceAdapter = {
      supportedTypes: ["ical"],
      async fetchNew(ctx) {
        seenUrl = ctx.source.url;
        return [];
      },
    };
    const wrapped = fromLegacyAdapter(
      "ical",
      { discovery: true, details: false, assets: false, incremental: false },
      legacy,
    );
    await wrapped.discover(
      makeSource({ url: "https://venue.example", discoveryUrl: "https://venue.example/feed.ics" }),
      {},
    );
    expect(seenUrl).toBe("https://venue.example/feed.ics");
  });

  it("falls back to url when no discoveryUrl is set", async () => {
    let seenUrl: string | null = null;
    const legacy: SourceAdapter = {
      supportedTypes: ["ical"],
      async fetchNew(ctx) {
        seenUrl = ctx.source.url;
        return [];
      },
    };
    const wrapped = fromLegacyAdapter(
      "ical",
      { discovery: true, details: false, assets: false, incremental: false },
      legacy,
    );
    await wrapped.discover(makeSource({ url: "https://venue.example" }), {});
    expect(seenUrl).toBe("https://venue.example");
  });

  it("forwards maxItems and fetchImpl from the crawl context", async () => {
    let seenMax: number | undefined;
    let sawFetch = false;
    const legacy: SourceAdapter = {
      supportedTypes: ["ical"],
      async fetchNew(ctx) {
        seenMax = ctx.maxItems;
        sawFetch = ctx.fetchImpl !== undefined;
        return [];
      },
    };
    const wrapped = fromLegacyAdapter(
      "ical",
      { discovery: true, details: false, assets: false, incremental: false },
      legacy,
    );
    await wrapped.discover(makeSource(), { maxItems: 7, fetchImpl: (async () => new Response("")) as typeof fetch });
    expect(seenMax).toBe(7);
    expect(sawFetch).toBe(true);
  });
});

describe("legacy source-type lookup", () => {
  it("still resolves the adapters the pre-refactor pipeline used", () => {
    // Guards the migration: the existing ingest path must not regress while
    // callers move over to adapterFor().
    expect(adapterForSourceType("athletics")).not.toBeNull();
    expect(adapterForSourceType("ical")).not.toBeNull();
    expect(adapterForSourceType("rss")).not.toBeNull();
    expect(adapterForSourceType("owl_central")).not.toBeNull();
    expect(adapterForSourceType("generic_webpage")).not.toBeNull();
  });

  it("never polls Instagram", () => {
    // Social is push-fed by an authorized connector. A registry entry here
    // would mean the crawler scraping the platform directly.
    expect(adapterForSourceType("instagram")).toBeNull();
  });

  it("has no generic adapter for manual submissions", () => {
    expect(adapterForSourceType("manual_submission")).toBeNull();
  });
});

describe("adapter naming", () => {
  it("contains no university-specific adapter types", () => {
    // Rule 1: adapters are platforms, never schools. "owl_central" is FAU's
    // name for its CampusLabs install and must not appear here.
    const schoolish = ["owl", "fau", "ucf", "knight", "central"];
    for (const type of ADAPTER_TYPES as readonly AdapterType[]) {
      for (const word of schoolish) {
        expect(type.toLowerCase()).not.toContain(word);
      }
    }
  });
});
