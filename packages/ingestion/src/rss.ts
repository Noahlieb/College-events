import { XMLParser } from "fast-xml-parser";
import type { DiscoveredItem, FetchContext, SourceAdapter } from "./types.js";
import { IngestionError } from "./types.js";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)["#text"]);
  }
  return String(value);
}

/** Parses RSS 2.0 <item> or Atom <entry> feeds into DiscoveredItems. */
export function parseFeed(xml: string): DiscoveredItem[] {
  const doc = parser.parse(xml);

  const rssItems = asArray(doc?.rss?.channel?.item);
  if (rssItems.length > 0) {
    return rssItems.map((item) => ({
      externalId: textOf(item.guid) ?? textOf(item.link) ?? textOf(item.title) ?? crypto.randomUUID(),
      sourceUrl: textOf(item.link),
      rawText: [textOf(item.title), textOf(item.description)].filter(Boolean).join("\n"),
      mediaUrl: item.enclosure?.["@_url"] ? String(item.enclosure["@_url"]) : null,
      publishedAt: parseRfc822OrIso(textOf(item.pubDate)),
      rawMetadata: { title: textOf(item.title) },
    }));
  }

  const atomEntries = asArray(doc?.feed?.entry);
  if (atomEntries.length > 0) {
    return atomEntries.map((entry) => {
      const link = Array.isArray(entry.link) ? entry.link[0] : entry.link;
      return {
        externalId: textOf(entry.id) ?? textOf(link?.["@_href"]) ?? crypto.randomUUID(),
        sourceUrl: link?.["@_href"] ? String(link["@_href"]) : null,
        rawText: [textOf(entry.title), textOf(entry.summary ?? entry.content)].filter(Boolean).join("\n"),
        mediaUrl: null,
        publishedAt: parseRfc822OrIso(textOf(entry.updated ?? entry.published)),
        rawMetadata: { title: textOf(entry.title) },
      };
    });
  }

  return [];
}

function parseRfc822OrIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Generic RSS/Atom source adapter (spec §7/§9). */
export const rssAdapter: SourceAdapter = {
  supportedTypes: ["rss"],
  async fetchNew(ctx: FetchContext): Promise<DiscoveredItem[]> {
    if (!ctx.source.url) {
      throw new IngestionError("RSS source has no URL configured", ctx.source.id);
    }
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const res = await fetchImpl(ctx.source.url, { headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!res.ok) throw new IngestionError(`RSS fetch failed: HTTP ${res.status}`, ctx.source.id);
    const items = parseFeed(await res.text());
    return ctx.maxItems ? items.slice(0, ctx.maxItems) : items;
  },
};
