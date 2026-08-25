import { describe, expect, it } from "vitest";
import { collegeNetAdapter, publisherFeedUrls, publisherToDiscovered } from "./collegenet.js";
import { campusGroupsAdapter, campusGroupsExternalId } from "./campusgroups.js";
import { lumaAdapter, partifulAdapter, tixrAdapter } from "./ticketing-platforms.js";
import {
  MissingCredentialError,
  eventbriteAdapter,
  eventbriteToDiscovered,
  largestImage,
  ticketmasterAdapter,
  ticketmasterToDiscovered,
} from "./keyed-platforms.js";
import { googleCalendarIcsUrl, largestTribeImage, tribeToDiscovered, wordpressAdapter } from "./web-platforms.js";
import { SourceAccessDeniedError } from "./adapter.js";
import type { SourceInstance } from "./adapter.js";
import { adapterSupport, platformSupported } from "./support.js";

function source(config: Record<string, unknown> = {}, overrides: Partial<SourceInstance> = {}): SourceInstance {
  return {
    id: "s1",
    schoolId: "u1",
    name: "Test",
    adapterType: "generic_web",
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
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

const eventPage = (name: string, image = "https://cdn/flyer.jpg") =>
  `<html><head>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "Event",
      name,
      startDate: "2026-09-04T22:00:00-04:00",
      location: { name: "The Vanguard" },
      image,
    })}</script>
    <meta property="og:image" content="https://cdn/og.jpg">
  </head></html>`;

const CHALLENGE = `<html><head><title>Just a moment...</title></head><body></body></html>`;

// ── 25Live ─────────────────────────────────────────────────────────

describe("25Live Publisher", () => {
  it("walks JSON, iCal then RSS rather than assuming one format", () => {
    // Which format a campus publishes varies; assuming one would make
    // half of them look unsupported.
    const urls = publisherFeedUrls(source({ calendarId: "1234" }));
    expect(urls[0]).toMatch(/\.json$/);
    expect(urls[1]).toMatch(/\.ics$/);
    expect(urls[2]).toMatch(/\.rss$/);
  });

  it("uses an explicit feedUrl alone when given one", () => {
    expect(publisherFeedUrls(source({ feedUrl: "https://x/feed.json" }))).toEqual(["https://x/feed.json"]);
  });

  it("reads a JSON feed", async () => {
    const fetchImpl = (async () =>
      json([{ id: 5, title: "Convocation", startDate: "2026-09-01T10:00:00" }])) as unknown as typeof fetch;
    const items = await collegeNetAdapter.discover(source({ calendarId: "c" }), { fetchImpl });
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toContain("25live");
  });

  it("falls through to iCal when the JSON feed is absent", async () => {
    const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x1\r\nSUMMARY:Fallback\r\nDTSTART:20260901T220000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const fetchImpl = (async (url: string) =>
      String(url).endsWith(".json")
        ? json({}, 404)
        : new Response(ics, { headers: { "content-type": "text/calendar" } })) as unknown as typeof fetch;

    const items = await collegeNetAdapter.discover(source({ calendarId: "c" }), { fetchImpl });
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe("x1");
  });

  it("surfaces a challenge immediately instead of trying every format", async () => {
    const fetchImpl = (async () => json({}, 403)) as unknown as typeof fetch;
    await expect(
      collegeNetAdapter.discover(source({ calendarId: "c" }), { fetchImpl }),
    ).rejects.toBeInstanceOf(SourceAccessDeniedError);
  });

  it("reads a bare array or a wrapped payload", () => {
    expect(publisherToDiscovered("https://h/f.json", { id: 1, title: "A" })).not.toBeNull();
    expect(publisherToDiscovered("https://h/f.json", { title: "no id" })).toBeNull();
  });

  it("offers no artwork rather than inventing a weak candidate", async () => {
    // Publisher feeds genuinely carry no imagery; a placeholder here would
    // outrank a real flyer from another source.
    expect(await collegeNetAdapter.discoverAssets!(source(), {} as never, {})).toEqual([]);
  });
});

// ── CampusGroups ───────────────────────────────────────────────────

describe("CampusGroups", () => {
  it("prefers the campus's own iCal feed when one is configured", async () => {
    const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:cg1\r\nSUMMARY:Club Night\r\nDTSTART:20260901T220000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const fetchImpl = (async () => new Response(ics)) as unknown as typeof fetch;
    const items = await campusGroupsAdapter.discover(
      source({ host: "ucf.campusgroups.com", icsUrl: "https://ucf.campusgroups.com/ical/x" }),
      { fetchImpl },
    );
    expect(items[0]!.externalId).toBe("cg1");
  });

  it("falls back to the public listing when the ics feed is stale", async () => {
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.includes("/ical/")) return new Response("", { status: 404 });
      if (u.endsWith("/events")) return html(`<a href="/event/77">Night</a>`);
      return html(eventPage("Club Night"));
    }) as unknown as typeof fetch;

    const items = await campusGroupsAdapter.discover(
      source({ host: "ucf.campusgroups.com", icsUrl: "https://ucf.campusgroups.com/ical/x" }),
      { fetchImpl },
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.rawMetadata!.platform).toBe("campusgroups");
  });

  it("keys events on the platform id so one event stays one row", () => {
    expect(campusGroupsExternalId("ucf.campusgroups.com", "https://ucf.campusgroups.com/event/77")).toBe(
      "campusgroups-ucf.campusgroups.com-77",
    );
  });

  it("reports a challenge rather than parsing the interstitial", async () => {
    const fetchImpl = (async () => html(CHALLENGE)) as unknown as typeof fetch;
    await expect(
      campusGroupsAdapter.discover(source({ host: "h" }), { fetchImpl }),
    ).rejects.toBeInstanceOf(SourceAccessDeniedError);
  });
});

// ── Luma / Partiful / Tixr ─────────────────────────────────────────

describe("structured-data platforms", () => {
  const cases = [
    { adapter: lumaAdapter, url: "https://lu.ma/neon-night", prefix: "luma" },
    { adapter: partifulAdapter, url: "https://partiful.com/e/abc123", prefix: "partiful" },
    { adapter: tixrAdapter, url: "https://www.tixr.com/e/summer-jam-12345", prefix: "tixr" },
  ];

  for (const { adapter, url, prefix } of cases) {
    it(`${prefix}: reads an admin-supplied event page`, async () => {
      const fetchImpl = (async () => html(eventPage("Neon Night"))) as unknown as typeof fetch;
      const items = await adapter.discover(source({ eventUrls: [url] }), { fetchImpl });
      expect(items).toHaveLength(1);
      expect(items[0]!.externalId.startsWith(prefix)).toBe(true);
      expect(items[0]!.mediaUrl).toBe("https://cdn/flyer.jpg");
    });

    it(`${prefix}: goes degraded on a challenge instead of crashing`, async () => {
      const fetchImpl = (async () => html(CHALLENGE)) as unknown as typeof fetch;
      await expect(adapter.discover(source({ eventUrls: [url] }), { fetchImpl })).rejects.toBeInstanceOf(
        SourceAccessDeniedError,
      );
    });

    it(`${prefix}: yields nothing rather than guessing when unconfigured`, async () => {
      expect(await adapter.discover(source(), { fetchImpl: (async () => html("")) as unknown as typeof fetch })).toEqual(
        [],
      );
    });
  }

  it("stops after the first challenge rather than walking every URL", async () => {
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return html(CHALLENGE);
    }) as unknown as typeof fetch;
    await lumaAdapter
      .discover(source({ eventUrls: ["https://lu.ma/a", "https://lu.ma/b", "https://lu.ma/c"] }), { fetchImpl })
      .catch(() => undefined);
    expect(requests).toBe(1);
  });

  it("keeps what it already collected when a later page is challenged", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call++;
      return call === 1 ? html(eventPage("First")) : html(CHALLENGE);
    }) as unknown as typeof fetch;
    const items = await lumaAdapter.discover(
      source({ eventUrls: ["https://lu.ma/a", "https://lu.ma/b"] }),
      { fetchImpl },
    );
    expect(items).toHaveLength(1);
  });

  it("offers both the event's own artwork and the page preview image", async () => {
    const fetchImpl = (async () => html(eventPage("Neon Night"))) as unknown as typeof fetch;
    const assets = await lumaAdapter.discoverAssets!(
      source(),
      {
        externalId: "x",
        sourceUrl: "https://lu.ma/x",
        rawText: null,
        mediaUrl: null,
        publishedAt: null,
        rawMetadata: {},
      },
      { fetchImpl },
    );
    const origins = assets.map((a) => a.origin);
    expect(origins).toContain("jsonld");
    expect(origins).toContain("opengraph");
    // The event's own JSON-LD image is the stronger claim.
    const ld = assets.find((a) => a.origin === "jsonld")!;
    const og = assets.find((a) => a.origin === "opengraph")!;
    expect(ld.confidence).toBeGreaterThan(og.confidence);
  });
});

// ── Eventbrite / Ticketmaster ──────────────────────────────────────

describe("credentialed platforms", () => {
  it("Eventbrite asks for a token rather than scraping without one", async () => {
    // The absence of a credential is not permission to take another route.
    const err = await eventbriteAdapter
      .discover(source({ organizationId: "1" }), { env: {} })
      .catch((e) => e);
    expect(err).toBeInstanceOf(MissingCredentialError);
    expect((err as MissingCredentialError).envVar).toBe("EVENTBRITE_API_TOKEN");
  });

  it("Eventbrite requires an organization to read, since public search is gone", async () => {
    await expect(
      eventbriteAdapter.discover(source(), { env: { EVENTBRITE_API_TOKEN: "t" } }),
    ).rejects.toThrow(/organizationId|organizerId/);
  });

  it("Eventbrite follows continuation pagination", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call++;
      return json({
        events: [{ id: `e${call}`, name: { text: `Event ${call}` } }],
        pagination: { has_more_items: call === 1, continuation: call === 1 ? "next" : null },
      });
    }) as unknown as typeof fetch;

    const items = await eventbriteAdapter.discover(source({ organizationId: "1" }), {
      env: { EVENTBRITE_API_TOKEN: "t" },
      fetchImpl,
    });
    expect(items).toHaveLength(2);
  });

  it("Eventbrite prefers the original upload over the resized crop", () => {
    // The flyer pipeline picks the largest copy of the same artwork.
    const item = eventbriteToDiscovered({
      id: "e1",
      name: { text: "Show" },
      logo: { url: "https://cdn/small.jpg", original: { url: "https://cdn/original.jpg" } },
    })!;
    expect(item.mediaUrl).toBe("https://cdn/original.jpg");
  });

  it("Ticketmaster asks for a key", async () => {
    await expect(
      ticketmasterAdapter.discover(source({ city: "Orlando" }), { env: {} }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it("Ticketmaster needs a market to scope to", async () => {
    await expect(
      ticketmasterAdapter.discover(source(), { env: { TICKETMASTER_API_KEY: "k" } }),
    ).rejects.toThrow(/city|latlong/);
  });

  it("Ticketmaster takes its geography from the source, not from code", async () => {
    let seen = "";
    const fetchImpl = (async (url: string) => {
      seen = String(url);
      return json({ _embedded: { events: [] }, page: { totalPages: 1 } });
    }) as unknown as typeof fetch;

    await ticketmasterAdapter.discover(source({ city: "Orlando", stateCode: "FL" }), {
      env: { TICKETMASTER_API_KEY: "k" },
      fetchImpl,
    });
    expect(new URL(seen).searchParams.get("city")).toBe("Orlando");
    expect(new URL(seen).searchParams.get("stateCode")).toBe("FL");
  });

  it("Ticketmaster picks the largest of the crops it publishes", () => {
    const best = largestImage([
      { url: "s", width: 100, height: 50 },
      { url: "l", width: 2048, height: 1152 },
      { url: "m", width: 640, height: 360 },
    ]);
    expect(best!.url).toBe("l");
  });

  it("Ticketmaster carries image dimensions so the flyer pipeline can rank copies", () => {
    const item = ticketmasterToDiscovered({
      id: "t1",
      name: "Concert",
      images: [{ url: "https://cdn/i.jpg", width: 2048, height: 1152 }],
    })!;
    expect(item.rawMetadata!.imageWidth).toBe(2048);
  });

  it("reports a rejected credential as denied access, not a crash", async () => {
    const fetchImpl = (async () => json({}, 401)) as unknown as typeof fetch;
    await expect(
      ticketmasterAdapter.discover(source({ city: "Orlando" }), {
        env: { TICKETMASTER_API_KEY: "bad" },
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(SourceAccessDeniedError);
  });
});

// ── WordPress / Google Calendar ────────────────────────────────────

describe("WordPress (The Events Calendar)", () => {
  it("follows the API's own next-page URL", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call++;
      return json({
        events: [{ id: call, title: "Show", start_date: "2026-09-01 20:00:00" }],
        next_rest_url: call === 1 ? "https://venue.com/wp-json/tribe/events/v1/events?page=2" : null,
      });
    }) as unknown as typeof fetch;

    const items = await wordpressAdapter.discover(source({}, { url: "https://venue.com" }), { fetchImpl });
    expect(items).toHaveLength(2);
  });

  it("says to use a generic source rather than guessing when the plugin is absent", async () => {
    const fetchImpl = (async () => json({}, 404)) as unknown as typeof fetch;
    await expect(
      wordpressAdapter.discover(source({}, { url: "https://venue.com" }), { fetchImpl }),
    ).rejects.toThrow(/jsonld|generic_web/);
  });

  it("picks the largest declared image size", () => {
    const best = largestTribeImage({
      url: "https://cdn/full.jpg",
      sizes: {
        thumbnail: { url: "https://cdn/t.jpg", width: 150, height: 150 },
        large: { url: "https://cdn/l.jpg", width: 1024, height: 768 },
      },
    });
    expect(best!.url).toBe("https://cdn/l.jpg");
  });

  it("strips markup out of descriptions", () => {
    const item = tribeToDiscovered("venue.com", {
      id: 1,
      title: "Show",
      description: "<p>Doors at <b>8pm</b></p>",
    })!;
    expect(item.rawText).toContain("Doors at 8pm");
    expect(item.rawText).not.toContain("<b>");
  });
});

describe("Google Calendar", () => {
  it("accepts a calendar id", () => {
    expect(googleCalendarIcsUrl(source({ calendarId: "abc@group.calendar.google.com" }))).toContain(
      "/public/basic.ics",
    );
  });

  it("accepts an embed URL, which is what people actually paste", () => {
    const url = googleCalendarIcsUrl(
      source({}, { url: "https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com" }),
    );
    expect(url).toContain("abc%40group.calendar.google.com");
  });

  it("accepts an ics link unchanged", () => {
    expect(googleCalendarIcsUrl(source({}, { url: "https://x/basic.ics" }))).toBe("https://x/basic.ics");
  });

  it("returns null when there is nothing resolvable", () => {
    expect(googleCalendarIcsUrl(source())).toBeNull();
  });
});

// ── support status ─────────────────────────────────────────────────

describe("adapterSupport", () => {
  const base = { active: true, healthStatus: "healthy" as const, env: {} };

  it("reports a crawlable platform as supported", () => {
    expect(adapterSupport({ ...base, adapterType: "localist" }).status).toBe("supported");
  });

  it("blames itself, not the source, for a missing adapter", () => {
    // A source we cannot read is our gap. Calling it "failed" would put a
    // red mark on something the operator did nothing wrong with.
    const support = adapterSupport({ ...base, adapterType: "external_social" });
    expect(support.status).toBe("no_adapter");
    expect(support.detail).toMatch(/gap on our side/i);
  });

  it("distinguishes a missing credential from a missing adapter", () => {
    const support = adapterSupport({ ...base, adapterType: "ticketmaster" });
    expect(support.status).toBe("auth_required");
    expect(support.missingCredentials).toEqual(["TICKETMASTER_API_KEY"]);
  });

  it("becomes supported once the credential is present", () => {
    expect(
      adapterSupport({ ...base, adapterType: "ticketmaster", env: { TICKETMASTER_API_KEY: "k" } }).status,
    ).toBe("supported");
  });

  it("escalates repeated refusal from degraded to blocked", () => {
    // Two different messages for an operator: "backing off" versus "stop
    // expecting this to recover, cover it another way".
    expect(
      adapterSupport({ ...base, adapterType: "posh", healthStatus: "degraded", consecutiveFailures: 1 }).status,
    ).toBe("degraded");
    expect(
      adapterSupport({ ...base, adapterType: "posh", healthStatus: "degraded", consecutiveFailures: 9 }).status,
    ).toBe("blocked");
  });

  it("lets an operator's off switch beat everything", () => {
    expect(adapterSupport({ ...base, adapterType: "localist", active: false }).status).toBe("disabled");
  });

  it("platformSupported answers for a platform regardless of any source", () => {
    expect(platformSupported("localist")).toBe(true);
    expect(platformSupported("external_social")).toBe(false);
    expect(platformSupported(null)).toBe(false);
  });
});
