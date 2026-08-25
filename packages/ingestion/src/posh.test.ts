import { describe, it, expect } from "vitest";
import { eventFromPage, extractEventLinks, looksChallenged, poshAdapter, slugFromUrl } from "./posh.js";
import { SourceAccessDeniedError } from "./adapter.js";
import type { SourceInstance } from "./adapter.js";

function source(config: Record<string, unknown> = {}, overrides: Partial<SourceInstance> = {}): SourceInstance {
  return {
    id: "src-posh",
    schoolId: "school-1",
    name: "Posh.vip Nightlife",
    adapterType: "posh",
    url: "https://posh.vip/explore",
    discoveryUrl: null,
    instagramHandle: null,
    config,
    metadata: {},
    categoryBias: "nightlife",
    lastSuccessfulCheckAt: null,
    lastEventFoundAt: null,
    ...overrides,
  };
}

const EVENT_PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": "Event",
  name: "Neon Night",
  startDate: "2026-09-04T22:00:00-04:00",
  location: { name: "The Wharf Fort Lauderdale" },
  image: "https://cdn.posh.vip/flyer.jpg",
})}</script></head><body></body></html>`;

const CHALLENGE_PAGE = `<html><head><title>Just a moment...</title></head>
<body><div class="cf-browser-verification"></div></body></html>`;

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

describe("challenge detection", () => {
  it("recognises an interstitial rather than parsing it as content", () => {
    expect(looksChallenged(CHALLENGE_PAGE)).toBe(true);
  });

  it("does not flag an ordinary event page", () => {
    expect(looksChallenged(EVENT_PAGE)).toBe(false);
  });
});

describe("slug + link extraction", () => {
  it("reads the slug out of an event URL", () => {
    expect(slugFromUrl("https://posh.vip/e/neon-night-9-4")).toBe("neon-night-9-4");
  });

  it("returns null for a non-event URL", () => {
    expect(slugFromUrl("https://posh.vip/explore")).toBeNull();
  });

  it("resolves listing links to absolute URLs and de-duplicates them", () => {
    const listing = `<a href="/e/one">1</a><a href="/e/one">dup</a><a href="/e/two">2</a>`;
    const links = extractEventLinks(listing, "https://posh.vip/explore");
    expect(links).toEqual(["https://posh.vip/e/one", "https://posh.vip/e/two"]);
  });
});

describe("eventFromPage", () => {
  it("keys the event on its slug so the same event stays one row", () => {
    // The same event can arrive from a listing crawl, an admin-supplied
    // URL, or a venue link in the entity graph. All three must dedupe.
    const item = eventFromPage("https://posh.vip/e/neon-night-9-4", EVENT_PAGE)!;
    expect(item.externalId).toBe("posh-neon-night-9-4");
  });

  it("keeps the flyer the promoter published", () => {
    const item = eventFromPage("https://posh.vip/e/neon-night-9-4", EVENT_PAGE)!;
    expect(item.mediaUrl).toBe("https://cdn.posh.vip/flyer.jpg");
  });

  it("returns null for a page with no event data", () => {
    expect(eventFromPage("https://posh.vip/e/x", "<html><body>nothing</body></html>")).toBeNull();
  });
});

describe("poshAdapter.discover — configured event URLs", () => {
  it("fetches admin-supplied event pages", async () => {
    const fetchImpl = (async () => html(EVENT_PAGE)) as unknown as typeof fetch;
    const items = await poshAdapter.discover(
      source({ eventUrls: ["https://posh.vip/e/neon-night-9-4"] }),
      { fetchImpl },
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.rawMetadata!.platform).toBe("posh");
  });

  it("honours maxItems", async () => {
    const fetchImpl = (async () => html(EVENT_PAGE)) as unknown as typeof fetch;
    const items = await poshAdapter.discover(
      source({ eventUrls: ["https://posh.vip/e/a", "https://posh.vip/e/b", "https://posh.vip/e/c"] }),
      { fetchImpl, maxItems: 2 },
    );
    expect(items).toHaveLength(2);
  });
});

describe("poshAdapter.discover — degraded behaviour", () => {
  it("raises access-denied on a challenge instead of parsing the interstitial", async () => {
    const fetchImpl = (async () => html(CHALLENGE_PAGE)) as unknown as typeof fetch;
    const err = await poshAdapter
      .discover(source({ eventUrls: ["https://posh.vip/e/a"] }), { fetchImpl })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SourceAccessDeniedError);
    expect((err as SourceAccessDeniedError).kind).toBe("cloudflare_challenge");
  });

  it("stops after the first challenge instead of hammering every URL", async () => {
    // Retrying into an active challenge is wasted work and looks like
    // exactly the abuse the challenge exists to stop.
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return html(CHALLENGE_PAGE);
    }) as unknown as typeof fetch;

    await poshAdapter
      .discover(
        source({ eventUrls: ["https://posh.vip/e/a", "https://posh.vip/e/b", "https://posh.vip/e/c"] }),
        { fetchImpl },
      )
      .catch(() => undefined);
    expect(requests).toBe(1);
  });

  it("keeps events it already collected when a later page is challenged", async () => {
    // Partial coverage beats none, and the run still yields real events.
    let call = 0;
    const fetchImpl = (async () => {
      call++;
      return call === 1 ? html(EVENT_PAGE) : html(CHALLENGE_PAGE);
    }) as unknown as typeof fetch;

    const items = await poshAdapter.discover(
      source({ eventUrls: ["https://posh.vip/e/a", "https://posh.vip/e/b"] }),
      { fetchImpl },
    );
    expect(items).toHaveLength(1);
  });

  it("treats a 403 as denied access, not a crash", async () => {
    const fetchImpl = (async () => html("", 403)) as unknown as typeof fetch;
    const err = await poshAdapter
      .discover(source({ eventUrls: ["https://posh.vip/e/a"] }), { fetchImpl })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SourceAccessDeniedError);
    expect((err as SourceAccessDeniedError).kind).toBe("http_403");
  });

  it("yields nothing rather than wrong data when nothing is configured", async () => {
    // The trending-rail lesson: a location-blind fallback returned
    // out-of-state events that looked like a successful run. Zero is the
    // honest answer.
    const items = await poshAdapter.discover(source(), { fetchImpl: (async () => html("")) as unknown as typeof fetch });
    expect(items).toEqual([]);
  });
});

describe("poshAdapter.healthCheck", () => {
  it("reports degraded — not failed — when challenged", async () => {
    // DEGRADED means "the platform declined automated access", which is
    // not a defect to fix and must not read as broken code.
    const fetchImpl = (async () => html(CHALLENGE_PAGE)) as unknown as typeof fetch;
    const health = await poshAdapter.healthCheck!(source({}, { discoveryUrl: "https://posh.vip/explore" }), {
      fetchImpl,
    });
    expect(health.status).toBe("degraded");
    expect(health.reason).toMatch(/challenge/i);
  });

  it("reports healthy when a page comes back normally", async () => {
    const fetchImpl = (async () => html(EVENT_PAGE)) as unknown as typeof fetch;
    const health = await poshAdapter.healthCheck!(source({}, { discoveryUrl: "https://posh.vip/explore" }), {
      fetchImpl,
    });
    expect(health.status).toBe("healthy");
  });

  it("reports disabled when the source has no URLs at all", async () => {
    const health = await poshAdapter.healthCheck!(source({}, { url: null }), {});
    expect(health.status).toBe("disabled");
  });
});
