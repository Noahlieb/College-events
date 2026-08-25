import { describe, expect, it } from "vitest";
import { localistAdapter, localistApiUrl, localistToDiscovered, resolveLocalistHost } from "./localist.js";
import { SourceAccessDeniedError } from "./adapter.js";
import type { SourceInstance } from "./adapter.js";

function source(config: Record<string, unknown> = {}, overrides: Partial<SourceInstance> = {}): SourceInstance {
  return {
    id: "src-loc",
    schoolId: "school-1",
    name: "UCF Events",
    adapterType: "localist",
    url: null,
    discoveryUrl: null,
    instagramHandle: null,
    config,
    metadata: {},
    categoryBias: null,
    lastSuccessfulCheckAt: null,
    lastEventFoundAt: null,
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const localistEvent = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  event: {
    id,
    title,
    description_text: "Come along",
    localist_url: `https://events.ucf.edu/event/${id}`,
    location_name: "Student Union",
    event_instances: [{ event_instance: { start: "2026-09-01T18:00:00-04:00" } }],
    ...extra,
  },
});

describe("host resolution", () => {
  it("prefers config over a URL", () => {
    expect(resolveLocalistHost(source({ host: "events.ucf.edu" }, { url: "https://other.edu" }))).toBe(
      "events.ucf.edu",
    );
  });
  it("derives the host from a URL", () => {
    expect(resolveLocalistHost(source({}, { url: "https://events.ucf.edu/calendar" }))).toBe("events.ucf.edu");
  });
  it("returns null with nothing to go on", () => {
    expect(resolveLocalistHost(source())).toBeNull();
  });
});

describe("localistApiUrl", () => {
  it("asks for a forward window rather than paging through history", () => {
    const url = new URL(localistApiUrl("events.ucf.edu", { page: 1, pageSize: 100, days: 45 }));
    expect(url.searchParams.get("days")).toBe("45");
    expect(url.pathname).toBe("/api/2/events");
  });

  it("never exceeds the API's page-size cap", () => {
    // Localist rejects pp above 100 rather than clamping it.
    const url = new URL(localistApiUrl("h", { page: 1, pageSize: 500, days: 30 }));
    expect(url.searchParams.get("pp")).toBe("100");
  });

  it("scopes to a group or place when configured", () => {
    const url = new URL(localistApiUrl("h", { page: 1, pageSize: 10, days: 30, groupId: 7, placeId: 9 }));
    expect(url.searchParams.get("group_id")).toBe("7");
    expect(url.searchParams.get("place_id")).toBe("9");
  });
});

describe("localistToDiscovered", () => {
  it("namespaces ids by host so two campuses never collide", () => {
    const a = localistToDiscovered("events.ucf.edu", localistEvent(42, "Kickoff").event)!;
    const b = localistToDiscovered("events.fau.edu", localistEvent(42, "Kickoff").event)!;
    expect(a.externalId).not.toBe(b.externalId);
  });

  it("keeps the calendar's own photo as the event image", () => {
    const item = localistToDiscovered(
      "h",
      localistEvent(1, "Show", { photo_url: "https://cdn/photo.jpg" }).event,
    )!;
    expect(item.mediaUrl).toBe("https://cdn/photo.jpg");
    expect(item.rawMetadata!.photoUrl).toBe("https://cdn/photo.jpg");
  });

  it("carries coordinates through as numbers", () => {
    const item = localistToDiscovered(
      "h",
      localistEvent(2, "Show", { geo: { latitude: "28.6", longitude: "-81.2" } }).event,
    )!;
    expect(item.rawMetadata!.latitude).toBeCloseTo(28.6);
    expect(item.rawMetadata!.longitude).toBeCloseTo(-81.2);
  });

  it("ignores unparseable coordinates rather than storing NaN", () => {
    const item = localistToDiscovered("h", localistEvent(3, "S", { geo: { latitude: "n/a" } }).event)!;
    expect(item.rawMetadata!.latitude).toBeNull();
  });

  it("skips rows with no id or title", () => {
    expect(localistToDiscovered("h", { title: "No id" })).toBeNull();
    expect(localistToDiscovered("h", { id: 1, title: "   " })).toBeNull();
  });
});

describe("localistAdapter.discover", () => {
  it("pages to the reported total page count", async () => {
    const seen: number[] = [];
    const fetchImpl = (async (url: string) => {
      const page = Number(new URL(String(url)).searchParams.get("page"));
      seen.push(page);
      return json({ events: [localistEvent(page, `Event ${page}`)], page: { current: page, total: 3 } });
    }) as unknown as typeof fetch;

    const items = await localistAdapter.discover(source({ host: "h" }), { fetchImpl });
    expect(seen).toEqual([1, 2, 3]);
    expect(items).toHaveLength(3);
  });

  it("stops at maxItems without fetching another page", async () => {
    let pages = 0;
    const fetchImpl = (async () => {
      pages++;
      return json({
        events: [localistEvent(1, "A"), localistEvent(2, "B"), localistEvent(3, "C")],
        page: { total: 10 },
      });
    }) as unknown as typeof fetch;

    const items = await localistAdapter.discover(source({ host: "h" }), { fetchImpl, maxItems: 2 });
    expect(items).toHaveLength(2);
    expect(pages).toBe(1);
  });

  it("stops on an empty page even if the total says otherwise", async () => {
    const fetchImpl = (async () => json({ events: [], page: { total: 5 } })) as unknown as typeof fetch;
    expect(await localistAdapter.discover(source({ host: "h" }), { fetchImpl })).toEqual([]);
  });

  it("reports a refusal as access-denied, not a generic failure", async () => {
    const fetchImpl = (async () => json({}, 429)) as unknown as typeof fetch;
    await expect(localistAdapter.discover(source({ host: "h" }), { fetchImpl })).rejects.toBeInstanceOf(
      SourceAccessDeniedError,
    );
  });

  it("treats a server error as retryable rather than denied", async () => {
    const fetchImpl = (async () => json({}, 500)) as unknown as typeof fetch;
    const err = await localistAdapter.discover(source({ host: "h" }), { fetchImpl }).catch((e) => e);
    expect(err).not.toBeInstanceOf(SourceAccessDeniedError);
  });

  it("fails loudly with no host", async () => {
    await expect(localistAdapter.discover(source(), {})).rejects.toThrow(/host/i);
  });
});

describe("localistAdapter.discoverAssets", () => {
  it("offers the calendar photo as official event art", async () => {
    const assets = await localistAdapter.discoverAssets!(
      source({ host: "h" }),
      {
        externalId: "x",
        sourceUrl: null,
        rawText: null,
        mediaUrl: null,
        publishedAt: null,
        rawMetadata: { photoUrl: "https://cdn/p.jpg" },
      },
      {},
    );
    expect(assets).toHaveLength(1);
    expect(assets[0]!.isOfficial).toBe(true);
  });

  it("offers nothing when the event has no photo", async () => {
    const assets = await localistAdapter.discoverAssets!(
      source(),
      { externalId: "x", sourceUrl: null, rawText: null, mediaUrl: null, publishedAt: null, rawMetadata: {} },
      {},
    );
    expect(assets).toEqual([]);
  });
});

describe("localistAdapter.healthCheck", () => {
  it("is degraded when access is refused", async () => {
    const fetchImpl = (async () => json({}, 403)) as unknown as typeof fetch;
    expect((await localistAdapter.healthCheck!(source({ host: "h" }), { fetchImpl })).status).toBe("degraded");
  });
  it("is healthy when the API answers", async () => {
    const fetchImpl = (async () => json({ events: [] })) as unknown as typeof fetch;
    expect((await localistAdapter.healthCheck!(source({ host: "h" }), { fetchImpl })).status).toBe("healthy");
  });
});
