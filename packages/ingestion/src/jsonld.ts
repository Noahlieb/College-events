import type { DiscoveredItem, FetchContext, SourceAdapter } from "./types.js";
import { IngestionError } from "./types.js";

interface JsonLdEventLike {
  "@type"?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  url?: string;
  image?: string | string[] | { url?: string };
  location?: { name?: string; address?: string | { streetAddress?: string; addressLocality?: string } };
  offers?: { price?: string | number } | { price?: string | number }[];
  identifier?: string;
}

function isEventType(node: JsonLdEventLike): boolean {
  const type = node["@type"];
  if (!type) return false;
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => t.toLowerCase().includes("event"));
}

/** Recursively collects every object in a parsed JSON-LD document, including
 * arrays and `@graph` wrappers, which many CMS/ticketing platforms use. */
function collectNodes(value: unknown, out: JsonLdEventLike[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, out);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    out.push(obj as JsonLdEventLike);
    if (obj["@graph"]) collectNodes(obj["@graph"], out);
  }
}

/** Extracts schema.org Event objects embedded as JSON-LD in an HTML page.
 * Most modern event/ticketing/venue sites (Eventbrite included) publish
 * this for SEO, making it a far more reliable structured source than
 * scraping rendered HTML (spec §9's "structured network endpoint" tier). */
export function extractJsonLdEvents(html: string): JsonLdEventLike[] {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const nodes: JsonLdEventLike[] = [];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]!.trim());
      collectNodes(parsed, nodes);
    } catch {
      // malformed JSON-LD on the page — skip it, don't fail the whole fetch
      continue;
    }
  }
  return nodes.filter(isEventType);
}

function priceOf(offers: JsonLdEventLike["offers"]): string | null {
  if (!offers) return null;
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (first?.price == null) return null;
  const raw = String(first.price);
  // schema.org Offer.price is typically a bare numeric string ("0", "25.00")
  // with currency implied by a separate priceCurrency field — prefix with $
  // (FAU is USD-only for the MVP) unless the source already included symbols/text.
  return /^\d+(\.\d+)?$/.test(raw) ? `$${raw}` : raw;
}

function locationOf(location: JsonLdEventLike["location"]): string | null {
  if (!location) return null;
  if (location.name) return location.name;
  if (typeof location.address === "string") return location.address;
  if (location.address?.streetAddress) return location.address.streetAddress;
  return null;
}

function imageOf(image: JsonLdEventLike["image"]): string | null {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return typeof image[0] === "string" ? image[0] : null;
  return image.url ?? null;
}

function toDiscoveredItem(node: JsonLdEventLike, pageUrl: string): DiscoveredItem {
  const textParts = [
    node.name,
    node.startDate ? `Start: ${node.startDate}` : null,
    node.endDate ? `End: ${node.endDate}` : null,
    locationOf(node.location) ? `Location: ${locationOf(node.location)}` : null,
    node.description,
  ].filter(Boolean);

  return {
    externalId: node.identifier ?? node.url ?? `${pageUrl}#${node.name ?? "event"}`,
    sourceUrl: node.url ?? pageUrl,
    rawText: textParts.join("\n"),
    mediaUrl: imageOf(node.image),
    publishedAt: null,
    rawMetadata: { price: priceOf(node.offers), startDate: node.startDate, endDate: node.endDate },
  };
}

/** Generic webpage adapter: fetches a page and extracts schema.org Event
 * JSON-LD. Covers venue_website, ticketing_website, eventbrite, and
 * generic_webpage source types — those platforms overwhelmingly ship
 * JSON-LD for SEO, so a single adapter serves all of them. `athletics` is
 * handled by sidearm.ts instead: SIDEARM Sports sites (the dominant NCAA
 * athletics site vendor, FAU included) ship zero JSON-LD, rendering
 * schedules client-side from an embedded Nuxt payload instead. Falls back
 * to an empty result (not an error) when a page has no JSON-LD Event data;
 * true last-resort HTML scraping is intentionally out of scope for the
 * MVP per spec §9 ("do not rely on brittle browser scraping").
 */
export const genericWebpageAdapter: SourceAdapter = {
  supportedTypes: ["generic_webpage", "venue_website", "ticketing_website", "eventbrite"],
  async fetchNew(ctx: FetchContext): Promise<DiscoveredItem[]> {
    if (!ctx.source.url) {
      throw new IngestionError("Webpage source has no URL configured", ctx.source.id);
    }
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const res = await fetchImpl(ctx.source.url, { headers: { Accept: "text/html" } });
    if (!res.ok) throw new IngestionError(`Webpage fetch failed: HTTP ${res.status}`, ctx.source.id);
    const html = await res.text();
    const nodes = extractJsonLdEvents(html);
    const items = nodes.map((n) => toDiscoveredItem(n, ctx.source.url!));
    return ctx.maxItems ? items.slice(0, ctx.maxItems) : items;
  },
};
