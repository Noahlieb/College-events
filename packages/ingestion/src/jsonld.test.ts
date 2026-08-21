import { describe, expect, it } from "vitest";
import { extractJsonLdEvents, genericWebpageAdapter } from "./jsonld.js";

const SAMPLE_HTML = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Sunset Sessions Live at Mizner Park",
  "startDate": "2026-08-28T19:00:00-04:00",
  "endDate": "2026-08-28T22:00:00-04:00",
  "description": "Free outdoor concert series.",
  "url": "https://example.com/events/sunset-sessions",
  "image": "https://example.com/media/sunset.jpg",
  "location": { "@type": "Place", "name": "Mizner Park Amphitheater" },
  "offers": { "@type": "Offer", "price": "0" }
}
</script>
</head><body></body></html>`;

describe("extractJsonLdEvents", () => {
  it("extracts a schema.org Event block", () => {
    const nodes = extractJsonLdEvents(SAMPLE_HTML);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe("Sunset Sessions Live at Mizner Park");
  });

  it("ignores non-Event JSON-LD and malformed script blocks", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      <script type="application/ld+json">not valid json</script>`;
    expect(extractJsonLdEvents(html)).toEqual([]);
  });
});

describe("genericWebpageAdapter", () => {
  it("maps extracted JSON-LD events into DiscoveredItems", async () => {
    const fakeFetch = (async () => new Response(SAMPLE_HTML, { status: 200 })) as unknown as typeof fetch;
    const items = await genericWebpageAdapter.fetchNew({
      source: { id: "src-1", url: "https://example.com/events/sunset-sessions", instagramHandle: null, metadata: {} },
      lastSuccessfulCheckAt: null,
      fetchImpl: fakeFetch,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.mediaUrl).toBe("https://example.com/media/sunset.jpg");
    expect(items[0]!.rawMetadata?.price).toBe("$0");
  });

  it("returns an empty array (not an error) when a page has no JSON-LD Event data", async () => {
    const fakeFetch = (async () => new Response("<html><body>no data</body></html>", { status: 200 })) as unknown as typeof fetch;
    const items = await genericWebpageAdapter.fetchNew({
      source: { id: "src-2", url: "https://example.com/no-events", instagramHandle: null, metadata: {} },
      lastSuccessfulCheckAt: null,
      fetchImpl: fakeFetch,
    });
    expect(items).toEqual([]);
  });
});
