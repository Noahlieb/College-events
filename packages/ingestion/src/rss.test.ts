import { describe, expect, it } from "vitest";
import { parseFeed, rssAdapter } from "./rss.js";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>South Florida Pro Sports</title>
    <item>
      <title>Miami Heat vs. Boston Celtics</title>
      <link>https://example.com/heat-celtics</link>
      <guid>heat-celtics-2026-09-05</guid>
      <pubDate>Wed, 05 Aug 2026 12:00:00 GMT</pubDate>
      <description>Preseason matchup at Kaseya Center.</description>
    </item>
  </channel>
</rss>`;

describe("parseFeed", () => {
  it("parses RSS 2.0 items into DiscoveredItems", () => {
    const items = parseFeed(SAMPLE_RSS);
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe("heat-celtics-2026-09-05");
    expect(items[0]!.sourceUrl).toBe("https://example.com/heat-celtics");
    expect(items[0]!.rawText).toContain("Miami Heat vs. Boston Celtics");
    expect(items[0]!.publishedAt).toBe(new Date("Wed, 05 Aug 2026 12:00:00 GMT").toISOString());
  });

  it("returns an empty array for a feed with no items/entries", () => {
    expect(parseFeed(`<rss version="2.0"><channel><title>Empty</title></channel></rss>`)).toEqual([]);
  });
});

describe("rssAdapter", () => {
  it("fetches and parses a feed via the injected fetch implementation", async () => {
    const fakeFetch = (async () => new Response(SAMPLE_RSS, { status: 200 })) as unknown as typeof fetch;
    const items = await rssAdapter.fetchNew({
      source: { id: "src-1", url: "https://example.com/feed.rss", instagramHandle: null, metadata: {} },
      lastSuccessfulCheckAt: null,
      fetchImpl: fakeFetch,
    });
    expect(items).toHaveLength(1);
  });
});
