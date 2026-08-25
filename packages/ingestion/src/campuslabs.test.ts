import { describe, it, expect } from "vitest";
import {
  campusLabsAdapter,
  engageImageUrl,
  resolveHost,
  searchUrl,
  stripHtml,
  toDiscoveredEvent,
} from "./campuslabs.js";
import { SourceAccessDeniedError } from "./adapter.js";
import type { SourceInstance } from "./adapter.js";

function source(config: Record<string, unknown> = {}, overrides: Partial<SourceInstance> = {}): SourceInstance {
  return {
    id: "src-cl",
    schoolId: "school-1",
    name: "Owl Central",
    adapterType: "campuslabs",
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function engageEvent(id: number, name: string, extra: Record<string, unknown> = {}) {
  return { id, name, startsOn: "2026-09-01T22:00:00Z", organizationName: "Student Union", ...extra };
}

describe("stripHtml", () => {
  it("renders Engage's HTML descriptions as plain text", () => {
    expect(stripHtml("<p>Free <b>pizza</b>!</p><p>Come by.</p>")).toBe("Free pizza!\n\nCome by.");
  });

  it("decodes the entities Engage emits", () => {
    expect(stripHtml("Rock &amp; Roll &#39;til 2am")).toBe("Rock & Roll 'til 2am");
  });

  it("treats null and empty as empty", () => {
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
  });
});

describe("host resolution", () => {
  it("prefers explicit config over a URL", () => {
    expect(resolveHost(source({ host: "ucf.campuslabs.com" }, { url: "https://fau.campuslabs.com" }))).toBe(
      "ucf.campuslabs.com",
    );
  });

  it("derives the host from a configured URL when config omits it", () => {
    expect(resolveHost(source({}, { url: "https://fau.campuslabs.com/engage/events" }))).toBe(
      "fau.campuslabs.com",
    );
  });

  it("returns null when there is nothing to derive from", () => {
    expect(resolveHost(source())).toBeNull();
  });
});

describe("searchUrl", () => {
  it("builds the same discovery query for any campus", () => {
    const url = searchUrl("ucf.campuslabs.com", {
      skip: 0,
      take: 50,
      endsAfter: "2026-08-25T00:00:00.000Z",
      startsBefore: "2026-10-09T00:00:00.000Z",
      status: "Approved",
    });
    expect(url).toContain("https://ucf.campuslabs.com/engage/api/discovery/event/search");
    expect(url).toContain("take=50");
    expect(url).toContain("status=Approved");
  });
});

describe("toDiscoveredEvent", () => {
  it("namespaces the external id by host so two campuses never collide", () => {
    // Engage ids are per-install, so a bare id would merge FAU event 42
    // with UCF event 42 the moment a second university is added.
    const fau = toDiscoveredEvent("fau.campuslabs.com", engageEvent(42, "Kickoff"))!;
    const ucf = toDiscoveredEvent("ucf.campuslabs.com", engageEvent(42, "Kickoff"))!;
    expect(fau.externalId).not.toBe(ucf.externalId);
  });

  it("links back to the event's page on its own campus", () => {
    const item = toDiscoveredEvent("fau.campuslabs.com", engageEvent(42, "Kickoff"))!;
    expect(item.sourceUrl).toBe("https://fau.campuslabs.com/engage/event/42");
  });

  it("keeps flyer art and the host org's avatar apart", () => {
    // The org avatar is a logo. Treating it as event art would give every
    // club event a "flyer" that is really just the club badge.
    const item = toDiscoveredEvent(
      "fau.campuslabs.com",
      engageEvent(7, "Night Market", { imagePath: "abc123", organizationProfilePicture: "logo999" }),
    )!;
    expect(item.rawMetadata!.imagePath).toBe("abc123");
    expect(item.rawMetadata!.organizationProfilePicture).toBe("logo999");
    expect(item.mediaUrl).toContain("abc123");
  });

  it("falls back to the org avatar only when there is no event image", () => {
    const item = toDiscoveredEvent(
      "fau.campuslabs.com",
      engageEvent(8, "Meeting", { organizationProfilePicture: "logo999" }),
    )!;
    expect(item.mediaUrl).toContain("logo999");
  });

  it("skips rows with no id or no name", () => {
    expect(toDiscoveredEvent("h", { name: "No id" })).toBeNull();
    expect(toDiscoveredEvent("h", { id: 1, name: "   " })).toBeNull();
  });
});

describe("engageImageUrl", () => {
  it("expands a stored path to the CDN", () => {
    expect(engageImageUrl("abc")).toBe(
      "https://se-images.campuslabs.com/clink/images/abc?preset=large-sq",
    );
  });
  it("passes an already-absolute URL through", () => {
    expect(engageImageUrl("https://cdn.example/x.jpg")).toBe("https://cdn.example/x.jpg");
  });
  it("returns null for nothing", () => {
    expect(engageImageUrl(null)).toBeNull();
  });
});

describe("campusLabsAdapter.discover", () => {
  it("paginates to the API's reported total", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      const skip = Number(new URL(String(url)).searchParams.get("skip"));
      const value = skip === 0 ? [engageEvent(1, "A"), engageEvent(2, "B")] : [engageEvent(3, "C")];
      return jsonResponse({ "@odata.count": 3, value });
    }) as unknown as typeof fetch;

    const items = await campusLabsAdapter.discover(source({ host: "fau.campuslabs.com", pageSize: 2 }), {
      fetchImpl,
      now: new Date("2026-08-25T00:00:00Z"),
    });
    expect(items).toHaveLength(3);
    expect(calls).toHaveLength(2);
  });

  it("stops at maxItems without fetching further pages", async () => {
    let pages = 0;
    const fetchImpl = (async () => {
      pages++;
      return jsonResponse({
        "@odata.count": 100,
        value: [engageEvent(1, "A"), engageEvent(2, "B"), engageEvent(3, "C")],
      });
    }) as unknown as typeof fetch;

    const items = await campusLabsAdapter.discover(source({ host: "h" }), { fetchImpl, maxItems: 2 });
    expect(items).toHaveLength(2);
    expect(pages).toBe(1);
  });

  it("reports a refusal as access-denied rather than a generic failure", async () => {
    // The crawler needs this distinction to mark DEGRADED and back off
    // instead of retrying into the same wall.
    const fetchImpl = (async () => jsonResponse({}, 403)) as unknown as typeof fetch;
    await expect(campusLabsAdapter.discover(source({ host: "h" }), { fetchImpl })).rejects.toBeInstanceOf(
      SourceAccessDeniedError,
    );
  });

  it("treats a server error as an ordinary retryable failure", async () => {
    const fetchImpl = (async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    const err = await campusLabsAdapter.discover(source({ host: "h" }), { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SourceAccessDeniedError);
  });

  it("falls back to the iCal feed when the API yields nothing", async () => {
    // Documented fallback order: structured endpoint → RSS → iCal → page.
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:fallback-1",
      "SUMMARY:Fallback Event",
      "DTSTART:20260901T220000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const fetchImpl = (async (url: string) =>
      String(url).endsWith(".ics") ? new Response(ics) : jsonResponse({}, 500)) as unknown as typeof fetch;

    const items = await campusLabsAdapter.discover(
      source({ host: "h", icsFallbackUrl: "https://h/events.ics" }),
      { fetchImpl },
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe("fallback-1");
  });

  it("fails loudly when no host can be resolved", async () => {
    await expect(campusLabsAdapter.discover(source(), {})).rejects.toThrow(/host/i);
  });
});

describe("campusLabsAdapter.discoverAssets", () => {
  it("offers event art as official and the org logo as not", async () => {
    const candidates = await campusLabsAdapter.discoverAssets!(
      source({ host: "h" }),
      {
        externalId: "x",
        sourceUrl: null,
        rawText: null,
        mediaUrl: null,
        publishedAt: null,
        rawMetadata: { imagePath: "flyer1", organizationProfilePicture: "logo1" },
      },
      {},
    );
    const official = candidates.filter((c) => c.isOfficial);
    expect(official).toHaveLength(1);
    expect(official[0]!.sourceUrl).toContain("flyer1");
    expect(candidates.find((c) => c.sourceUrl.includes("logo1"))!.isOfficial).toBe(false);
  });

  it("offers nothing when the event carries no images", async () => {
    const candidates = await campusLabsAdapter.discoverAssets!(
      source(),
      { externalId: "x", sourceUrl: null, rawText: null, mediaUrl: null, publishedAt: null, rawMetadata: {} },
      {},
    );
    expect(candidates).toEqual([]);
  });
});

describe("campusLabsAdapter.healthCheck", () => {
  it("reports degraded when access is refused", async () => {
    const fetchImpl = (async () => jsonResponse({}, 429)) as unknown as typeof fetch;
    const health = await campusLabsAdapter.healthCheck!(source({ host: "h" }), { fetchImpl });
    expect(health.status).toBe("degraded");
  });

  it("reports healthy when the API answers", async () => {
    const fetchImpl = (async () => jsonResponse({ value: [] })) as unknown as typeof fetch;
    const health = await campusLabsAdapter.healthCheck!(source({ host: "h" }), { fetchImpl });
    expect(health.status).toBe("healthy");
  });
});
