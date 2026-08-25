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
import { extractJsonLdEvents, jsonLdToDiscoveredItem } from "./jsonld.js";

/**
 * posh.vip nightlife listings.
 *
 * posh.vip runs bot management in front of `/explore` and challenges
 * automated requests. **We do not attempt to defeat that** — no CAPTCHA
 * solving, no fingerprint spoofing, no proxy rotation. An active edge
 * challenge is the site's access control, and `robots.txt` permitting a
 * path does not override it.
 *
 * So this adapter is built to *degrade*, not to win. When a request is
 * challenged it raises SourceAccessDeniedError, the crawler records
 * DEGRADED with the reason and stops retrying, and the events are left for
 * other sources to cover — a venue's own site, an organizer page, a
 * ticketing platform. Nightlife coverage is therefore never gated on this
 * one source being reachable, which is the actual product requirement.
 *
 * Three legitimate discovery paths, in preference order:
 *  1. `config.eventUrls` — event pages supplied by an admin or resolved
 *     from a venue/organizer link elsewhere in the entity graph. Individual
 *     `/e/{slug}` pages carry schema.org JSON-LD and are usually served
 *     without a challenge.
 *  2. `discoveryUrl` — a configured public listing page, when accessible.
 *  3. Nothing. A degraded source yields zero rather than yielding wrong
 *     data, which is the lesson from the trending-rail incident: a rail
 *     that ignores the location filter returned out-of-state events that
 *     looked like a successful run.
 */

const CHALLENGE_MARKERS = [
  "just a moment",
  "cf-browser-verification",
  "cf_chl_opt",
  "challenge-platform",
  "enable javascript and cookies to continue",
  "attention required! | cloudflare",
];

/** True when a response body is an anti-bot interstitial rather than content. */
export function looksChallenged(html: string): boolean {
  const head = html.slice(0, 4000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => head.includes(marker));
}

function stringArrayConfig(source: SourceInstance, key: string): string[] {
  const value = source.config[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/** Fetch one page, translating a challenge or refusal into DEGRADED. */
async function fetchPage(
  url: string,
  fetchImpl: typeof fetch,
  sourceId: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchImpl(url, { headers: { Accept: "text/html" }, signal });
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    throw new SourceAccessDeniedError(
      `posh.vip declined automated access (HTTP ${res.status})`,
      sourceId,
      `http_${res.status}`,
    );
  }
  if (!res.ok) {
    throw new SourceAccessDeniedError(
      `posh.vip returned HTTP ${res.status}`,
      sourceId,
      `http_${res.status}`,
    );
  }
  const html = await res.text();
  if (looksChallenged(html)) {
    throw new SourceAccessDeniedError(
      "posh.vip served an anti-bot challenge instead of listings",
      sourceId,
      "cloudflare_challenge",
    );
  }
  return html;
}

export function slugFromUrl(url: string): string | null {
  const match = /\/e\/([A-Za-z0-9._~-]+)/.exec(url);
  return match ? match[1]! : null;
}

/**
 * Turns one `/e/{slug}` page's JSON-LD into a discovered event, reusing the
 * generic extractor so posh pages get the same field handling (and the same
 * test coverage) as every other JSON-LD source. Only the external id is
 * platform-specific: keying on the slug means the same event stays one row
 * whether it arrived from a listing crawl, an admin-supplied URL, or a
 * venue link resolved elsewhere in the entity graph.
 */
export function eventFromPage(url: string, html: string): DiscoveredEvent | null {
  const [node] = extractJsonLdEvents(html);
  if (!node) return null;
  const slug = slugFromUrl(url);
  const item = jsonLdToDiscoveredItem(node, url);
  return {
    ...item,
    externalId: `posh-${slug ?? url}`,
    sourceUrl: url,
    rawMetadata: { ...item.rawMetadata, platform: "posh", slug },
  };
}

export const poshAdapter: EventSourceAdapter = {
  type: "posh",
  capabilities: { discovery: true, details: false, assets: true, incremental: false },

  async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
    const fetchImpl = context.fetchImpl ?? fetch;
    const eventUrls = stringArrayConfig(source, "eventUrls");
    const items: DiscoveredEvent[] = [];
    let challenge: SourceAccessDeniedError | null = null;

    // Path 1: known event pages. Each is independent — one challenged page
    // does not abandon the rest, but the first challenge is remembered so
    // the run still reports DEGRADED rather than a clean partial success.
    for (const url of eventUrls) {
      if (context.maxItems && items.length >= context.maxItems) break;
      try {
        const html = await fetchPage(url, fetchImpl, source.id, context.signal);
        const item = eventFromPage(url, html);
        if (item) items.push(item);
      } catch (err) {
        if (err instanceof SourceAccessDeniedError) {
          challenge ??= err;
          // Stop hammering: if the platform is challenging us, the next
          // page will be challenged too. Wasteful retries are exactly what
          // the degraded path exists to prevent.
          break;
        }
        throw err;
      }
    }

    // Path 2: a configured listing page, only when nothing else produced
    // events and only when it is actually reachable.
    const listing = source.discoveryUrl;
    if (items.length === 0 && !challenge && listing) {
      try {
        const html = await fetchPage(listing, fetchImpl, source.id, context.signal);
        for (const url of extractEventLinks(html, listing)) {
          if (context.maxItems && items.length >= context.maxItems) break;
          const pageHtml = await fetchPage(url, fetchImpl, source.id, context.signal);
          const item = eventFromPage(url, pageHtml);
          if (item) items.push(item);
        }
      } catch (err) {
        if (err instanceof SourceAccessDeniedError) challenge ??= err;
        else throw err;
      }
    }

    // Surfacing the challenge only when we found nothing keeps a partial
    // success useful while still marking the source degraded when it is.
    if (items.length === 0 && challenge) throw challenge;
    return items;
  },

  async discoverAssets(_source: SourceInstance, event: RawEventPayload): Promise<AssetCandidate[]> {
    if (!event.mediaUrl) return [];
    // A posh event page's own artwork is the promoter's real flyer.
    return [{ sourceUrl: event.mediaUrl, origin: "jsonld", isOfficial: true, confidence: 0.85 }];
  },

  async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
    const checkedAt = context.now ?? new Date();
    const target = source.discoveryUrl ?? source.url ?? stringArrayConfig(source, "eventUrls")[0];
    if (!target) {
      return { status: "disabled", reason: "no posh URLs configured", checkedAt };
    }
    try {
      await fetchPage(target, context.fetchImpl ?? fetch, source.id, context.signal);
      return { status: "healthy", checkedAt };
    } catch (err) {
      if (err instanceof SourceAccessDeniedError) {
        return { status: "degraded", reason: err.message, checkedAt };
      }
      return { status: "failed", reason: (err as Error).message, checkedAt };
    }
  },
};

/** Absolute `/e/{slug}` URLs linked from a listing page, de-duplicated. */
export function extractEventLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const match of html.matchAll(/href=["'](\/e\/[^"'?#]+)/g)) {
    try {
      out.add(new URL(match[1]!, baseUrl).toString());
    } catch {
      // malformed href — skip it rather than fail the page
    }
  }
  return [...out];
}
