import { describe, expect, it } from "vitest";
import { DealIngestionError, fetchDealSource, normalizePageText } from "./deal-source.js";

function fakeFetch(html: string, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      text: async () => html,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("normalizePageText", () => {
  it("strips scripts, styles, comments, and tags down to plain text", () => {
    const html = `<html><head><style>.a{}</style><script>var x=1;</script></head><body><!-- hi --><h1>Wing Wednesday</h1><p>50% off wings</p></body></html>`;
    expect(normalizePageText(html)).toBe("Wing Wednesday 50% off wings");
  });
});

describe("fetchDealSource", () => {
  it("reports changed=true and a fresh hash on first check", async () => {
    const result = await fetchDealSource({
      url: "https://example.com/specials",
      previousHash: null,
      fetchImpl: fakeFetch("<p>$6 burgers every Tuesday</p>"),
    });
    expect(result.changed).toBe(true);
    expect(result.normalizedText).toBe("$6 burgers every Tuesday");
    expect(result.contentHash).toHaveLength(64);
  });

  it("reports changed=false when the hash matches the previous check", async () => {
    const first = await fetchDealSource({
      url: "https://example.com/specials",
      previousHash: null,
      fetchImpl: fakeFetch("<p>$6 burgers every Tuesday</p>"),
    });
    const second = await fetchDealSource({
      url: "https://example.com/specials",
      previousHash: first.contentHash,
      fetchImpl: fakeFetch("<p>$6 burgers every Tuesday</p>"),
    });
    expect(second.changed).toBe(false);
  });

  it("reports changed=true when page content differs from the previous hash", async () => {
    const first = await fetchDealSource({
      url: "https://example.com/specials",
      previousHash: null,
      fetchImpl: fakeFetch("<p>$6 burgers every Tuesday</p>"),
    });
    const second = await fetchDealSource({
      url: "https://example.com/specials",
      previousHash: first.contentHash,
      fetchImpl: fakeFetch("<p>$8 burgers every Tuesday</p>"),
    });
    expect(second.changed).toBe(true);
  });

  it("throws a DealIngestionError on a non-OK response", async () => {
    await expect(
      fetchDealSource({ url: "https://example.com/gone", previousHash: null, fetchImpl: fakeFetch("", false, 404) }),
    ).rejects.toBeInstanceOf(DealIngestionError);
  });
});
