import { describe, expect, it } from "vitest";
import { AUTO_APPROVE_CONFIDENCE, fingerprintPage, fingerprintUrl, hasJsonLdEvents } from "./fingerprint.js";

describe("fingerprintUrl — platform hosts", () => {
  const cases: [string, string][] = [
    ["https://fau.campuslabs.com/engage/events", "campuslabs"],
    ["https://knightconnect.ucf.edu.campusgroups.com/events", "campusgroups"],
    ["https://events.localist.com/calendar", "localist"],
    ["https://25live.collegenet.com/pro/ucf", "25live"],
    ["https://www.eventbrite.com/o/somebody", "eventbrite"],
    ["https://posh.vip/e/neon-night", "posh"],
    ["https://partiful.com/e/abc", "partiful"],
    ["https://lu.ma/somewhere", "luma"],
    ["https://www.ticketmaster.com/venue/123", "ticketmaster"],
    ["https://www.tixr.com/groups/venue", "tixr"],
  ];

  for (const [url, expected] of cases) {
    it(`identifies ${expected} from its own domain`, () => {
      const fp = fingerprintUrl(url);
      expect(fp.adapterType).toBe(expected);
      expect(fp.confidence).toBeGreaterThanOrEqual(AUTO_APPROVE_CONFIDENCE);
    });
  }

  it("recognises a different campus on a known platform", () => {
    // The whole point: a university this code has never seen resolves to
    // an adapter that already exists.
    const fp = fingerprintUrl("https://ucf.campuslabs.com/engage/events");
    expect(fp.adapterType).toBe("campuslabs");
  });
});

describe("fingerprintUrl — paths on a university's own domain", () => {
  it("spots an Engage install behind a campus vanity domain", () => {
    const fp = fingerprintUrl("https://knightconnect.ucf.edu/engage/events");
    expect(fp.adapterType).toBe("campuslabs");
    expect(fp.evidence.join()).toMatch(/engage/i);
  });

  it("spots a calendar feed by extension", () => {
    expect(fingerprintUrl("https://ucf.edu/events/feed.ics").adapterType).toBe("ical");
  });

  it("spots an RSS path", () => {
    expect(fingerprintUrl("https://ucf.edu/news/feed/").adapterType).toBe("rss");
  });
});

describe("fingerprintUrl — page markers", () => {
  it("identifies Localist from its generator meta", () => {
    const html = `<html><head><meta name="generator" content="Localist 3.2"></head></html>`;
    const fp = fingerprintUrl("https://events.ucf.edu/", html);
    expect(fp.adapterType).toBe("localist");
  });

  it("identifies WordPress from generator and asset paths", () => {
    const html = `<html><head><meta name="generator" content="WordPress 6.4"></head>
      <body><img src="/wp-content/uploads/a.jpg"></body></html>`;
    const fp = fingerprintUrl("https://somevenue.com/events", html);
    expect(fp.adapterType).toBe("wordpress");
  });

  it("identifies a SIDEARM athletics site from its Nuxt payload", () => {
    // SIDEARM ships no JSON-LD, so this is the only structural tell.
    const html = `<script id="__NUXT_DATA__">["Reactive",1,{"sidearm":2}]</script>`;
    const fp = fingerprintUrl("https://ucfknights.com/calendar", html);
    expect(fp.adapterType).toBe("sidearm");
  });

  it("reads a raw iCalendar document", () => {
    const fp = fingerprintUrl("https://ucf.edu/x", "BEGIN:VCALENDAR\nVERSION:2.0\n");
    expect(fp.adapterType).toBe("ical");
  });

  it("reads a raw RSS document", () => {
    const fp = fingerprintUrl("https://ucf.edu/x", '<?xml version="1.0"?><rss version="2.0"><channel>');
    expect(fp.adapterType).toBe("rss");
  });
});

describe("fingerprintUrl — JSON-LD as the weakest signal", () => {
  it("falls back to jsonld when a page describes events but names no platform", () => {
    const html = `<script type="application/ld+json">{"@type":"Event","name":"Show"}</script>`;
    const fp = fingerprintUrl("https://someindievenue.com/shows", html);
    expect(fp.adapterType).toBe("jsonld");
  });

  it("lets a specific platform outrank generic JSON-LD on the same page", () => {
    // Eventbrite pages ship JSON-LD too; the platform adapter knows more
    // about pagination and ids than the generic extractor does.
    const html = `<script type="application/ld+json">{"@type":"Event","name":"Show"}</script>`;
    const fp = fingerprintUrl("https://www.eventbrite.com/e/123", html);
    expect(fp.adapterType).toBe("eventbrite");
  });

  it("detects event JSON-LD inside an @graph wrapper", () => {
    expect(hasJsonLdEvents(`<script type="application/ld+json">{"@graph":[{"@type":"MusicEvent"}]}</script>`)).toBe(
      true,
    );
  });

  it("does not treat non-event JSON-LD as events", () => {
    expect(hasJsonLdEvents(`<script type="application/ld+json">{"@type":"Organization"}</script>`)).toBe(false);
  });
});

describe("fingerprintUrl — combining signals", () => {
  it("is more confident when independent signals agree", () => {
    const urlOnly = fingerprintUrl("https://knightconnect.ucf.edu/engage/events");
    const withPage = fingerprintUrl(
      "https://knightconnect.ucf.edu/engage/events",
      `<script>fetch("/engage/api/discovery/event/search")</script>`,
    );
    expect(withPage.confidence).toBeGreaterThan(urlOnly.confidence);
    expect(withPage.evidence.length).toBeGreaterThan(urlOnly.evidence.length);
  });

  it("never reports a confidence of exactly 1", () => {
    // Detection is inference. Leaving headroom keeps "certain" meaningful
    // and keeps a human in the loop for the genuinely ambiguous cases.
    const fp = fingerprintUrl(
      "https://fau.campuslabs.com/engage/events",
      `campuslabs.com /engage/api/discovery`,
    );
    expect(fp.confidence).toBeLessThan(1);
  });
});

describe("fingerprintUrl — unknown pages", () => {
  it("falls back to generic_web with low confidence", () => {
    const fp = fingerprintUrl("https://some-random-club.example/", "<html><body>hello</body></html>");
    expect(fp.adapterType).toBe("generic_web");
    expect(fp.confidence).toBeLessThan(AUTO_APPROVE_CONFIDENCE);
  });

  it("survives a malformed URL", () => {
    expect(() => fingerprintUrl("not a url")).not.toThrow();
  });

  it("always explains itself", () => {
    // A human approves these; a bare score is not reviewable.
    for (const url of ["https://fau.campuslabs.com/engage", "https://unknown.example"]) {
      expect(fingerprintUrl(url).evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("fingerprintPage", () => {
  it("trusts the content type over page markup", async () => {
    const fetchImpl = (async () =>
      new Response("BEGIN:VCALENDAR", { headers: { "content-type": "text/calendar" } })) as unknown as typeof fetch;
    const fp = await fingerprintPage("https://ucf.edu/events", fetchImpl);
    expect(fp.adapterType).toBe("ical");
  });

  it("degrades to a URL-only verdict when a page will not load", async () => {
    // Discovery inspects many unfamiliar hosts. One refusing to be read is
    // a candidate for review, not an error to propagate.
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const fp = await fingerprintPage("https://posh.vip/e/x", fetchImpl);
    expect(fp.adapterType).toBe("posh");
    expect(fp.confidence).toBeLessThan(0.2);
    expect(fp.evidence.join()).toMatch(/could not fetch/i);
  });

  it("degrades on a non-OK response without throwing", async () => {
    const fetchImpl = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    const fp = await fingerprintPage("https://someclub.example/events", fetchImpl);
    expect(fp.confidence).toBeLessThan(0.2);
    expect(fp.evidence.join()).toMatch(/403/);
  });
});
