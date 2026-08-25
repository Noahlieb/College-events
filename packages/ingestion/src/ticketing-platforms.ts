import type { AdapterType } from "@college-events/core";
import type {
  AssetCandidate,
  CrawlContext,
  DiscoveredEvent,
  EventSourceAdapter,
  RawEventPayload,
  SourceHealth,
  SourceInstance,
} from "./adapter.js";
import { SourceAccessDeniedError } from "./adapter.js";
import {
  assetsFromPage,
  eventFromStructuredPage,
  extractLinks,
  fetchStructuredPage,
} from "./structured-page.js";

/**
 * Luma, Partiful and Tixr.
 *
 * All three keep their real APIs behind partner or host authentication,
 * and all three publish schema.org JSON-LD and OpenGraph on public event
 * pages so link previews and search engines can read them. Reading exactly
 * that is the supported public access pattern — no private endpoints, no
 * rendering the SPA, no working around anything. A page that answers with
 * a challenge is reported DEGRADED and left alone.
 *
 * These are one implementation rather than three because the differences
 * between them are genuinely just a URL shape and an id: writing three
 * near-identical files would mean three places to fix the next time one of
 * them changes its markup.
 *
 * Config (all optional):
 * ```jsonc
 * {
 *   "eventUrls": ["https://lu.ma/abc123"],  // admin-supplied or graph-resolved
 *   "listingUrl": "https://lu.ma/orlando"   // a calendar/organizer page
 * }
 * ```
 */

interface PlatformSpec {
  type: AdapterType;
  label: string;
  /** Matches an event path on a listing page. */
  eventPathPattern: RegExp;
  /** Pulls the platform's own id out of an event URL. */
  externalId(url: string): string;
}

function slugId(prefix: string, url: string, pattern: RegExp): string {
  const match = pattern.exec(url);
  if (match?.[1]) return `${prefix}-${match[1]}`;
  try {
    return `${prefix}-${new URL(url).pathname.replace(/^\/+|\/+$/g, "")}`;
  } catch {
    return `${prefix}-${url}`;
  }
}

const SPECS: PlatformSpec[] = [
  {
    type: "luma",
    label: "Luma",
    // Luma event URLs are a bare slug at the root; a listing page links
    // them alongside plenty of non-event paths, so the pattern is narrow.
    eventPathPattern: /^\/(?!(?:signin|login|discover|pricing|about|terms|privacy|home)(?:\/|$))[A-Za-z0-9][A-Za-z0-9-]{2,}$/,
    externalId: (url) => slugId("luma", url, /lu\.ma\/([A-Za-z0-9-]+)/),
  },
  {
    type: "partiful",
    label: "Partiful",
    eventPathPattern: /^\/e\/[A-Za-z0-9-]+/,
    externalId: (url) => slugId("partiful", url, /\/e\/([A-Za-z0-9-]+)/),
  },
  {
    type: "tixr",
    label: "Tixr",
    eventPathPattern: /^\/(?:e|events|groups\/[^/]+\/events)\/[A-Za-z0-9-]+/,
    externalId: (url) => slugId("tixr", url, /\/(?:e|events)\/(?:[^/]*-)?(\d+)/),
  },
];

function stringArrayConfig(source: SourceInstance, key: string): string[] {
  const value = source.config[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function stringConfig(source: SourceInstance, key: string): string | null {
  const value = source.config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildAdapter(spec: PlatformSpec): EventSourceAdapter {
  return {
    type: spec.type,
    capabilities: { discovery: true, details: false, assets: true, incremental: false },

    async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
      const fetchImpl = context.fetchImpl ?? fetch;
      const items: DiscoveredEvent[] = [];
      const seen = new Set<string>();
      let challenge: SourceAccessDeniedError | null = null;

      const collect = async (url: string): Promise<void> => {
        if (seen.has(url)) return;
        seen.add(url);
        const html = await fetchStructuredPage(url, source.id, fetchImpl, context.signal);
        const item = eventFromStructuredPage(url, html, {
          platform: spec.type,
          externalId: spec.externalId(url),
        });
        if (item) items.push(item);
      };

      // Known event pages first: admin-supplied, or resolved from a venue
      // or organizer already in the entity graph.
      for (const url of stringArrayConfig(source, "eventUrls")) {
        if (context.maxItems && items.length >= context.maxItems) break;
        try {
          await collect(url);
        } catch (err) {
          if (err instanceof SourceAccessDeniedError) {
            // Stop rather than walk every remaining URL into the same wall.
            challenge ??= err;
            break;
          }
          throw err;
        }
      }

      const listingUrl = stringConfig(source, "listingUrl") ?? source.discoveryUrl;
      if (!challenge && listingUrl && (!context.maxItems || items.length < context.maxItems)) {
        try {
          const listingHtml = await fetchStructuredPage(listingUrl, source.id, fetchImpl, context.signal);
          for (const url of extractLinks(listingHtml, listingUrl, spec.eventPathPattern)) {
            if (context.maxItems && items.length >= context.maxItems) break;
            await collect(url);
          }
        } catch (err) {
          if (err instanceof SourceAccessDeniedError) challenge ??= err;
          else throw err;
        }
      }

      // A partial harvest is still useful; only report the challenge when
      // it cost us everything.
      if (items.length === 0 && challenge) throw challenge;
      return items;
    },

    async discoverAssets(
      source: SourceInstance,
      event: RawEventPayload,
      context: CrawlContext,
    ): Promise<AssetCandidate[]> {
      if (!event.sourceUrl) return [];
      try {
        const html = await fetchStructuredPage(
          event.sourceUrl,
          source.id,
          context.fetchImpl ?? fetch,
          context.signal,
        );
        // The platform hosts the event, so what it publishes for it is the
        // organizer's own artwork.
        return assetsFromPage(html, { isOfficial: true });
      } catch {
        return [];
      }
    },

    async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
      const checkedAt = context.now ?? new Date();
      const target =
        stringConfig(source, "listingUrl") ??
        source.discoveryUrl ??
        source.url ??
        stringArrayConfig(source, "eventUrls")[0];
      if (!target) {
        return { status: "disabled", reason: `no ${spec.label} URLs configured`, checkedAt };
      }
      try {
        await fetchStructuredPage(target, source.id, context.fetchImpl ?? fetch, context.signal);
        return { status: "healthy", checkedAt };
      } catch (err) {
        if (err instanceof SourceAccessDeniedError) {
          return { status: "degraded", reason: err.message, checkedAt };
        }
        return { status: "failed", reason: (err as Error).message, checkedAt };
      }
    },
  };
}

export const lumaAdapter = buildAdapter(SPECS[0]!);
export const partifulAdapter = buildAdapter(SPECS[1]!);
export const tixrAdapter = buildAdapter(SPECS[2]!);
export const structuredPlatformAdapters = [lumaAdapter, partifulAdapter, tixrAdapter];
