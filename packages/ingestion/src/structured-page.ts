import type { AssetCandidate, DiscoveredEvent } from "./adapter.js";
import { SourceAccessDeniedError } from "./adapter.js";
import { extractJsonLdEvents, jsonLdToDiscoveredItem, type JsonLdEventLike } from "./jsonld.js";

/**
 * Shared machinery for platforms whose public surface is "an HTML page
 * with structured data in it" — Luma, Partiful, Tixr, and the fallback
 * path for several campus platforms.
 *
 * These platforms have real APIs, but they are partner/authenticated APIs.
 * What they publish publicly is schema.org JSON-LD and OpenGraph, put
 * there deliberately so that link previews and search engines can read
 * them. Reading exactly that is the supported public access pattern, and
 * it is the whole extent of what these adapters do — no private endpoints,
 * no rendering the SPA, no working around anything.
 */

const CHALLENGE_MARKERS = [
  "just a moment",
  "cf-browser-verification",
  "cf_chl_opt",
  "challenge-platform",
  "enable javascript and cookies to continue",
  "attention required",
  "verifying you are human",
];

/** True when a body is an anti-bot interstitial rather than content. */
export function isChallengePage(html: string): boolean {
  const head = html.slice(0, 4000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => head.includes(marker));
}

/**
 * Fetches a page, translating refusal into the access-denied error the
 * crawler turns into DEGRADED. Never retries into a challenge.
 */
export async function fetchStructuredPage(
  url: string,
  sourceId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { Accept: "text/html,application/xhtml+xml" },
    signal,
  });

  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503) {
    throw new SourceAccessDeniedError(
      `platform declined automated access (HTTP ${res.status})`,
      sourceId,
      `http_${res.status}`,
    );
  }
  if (!res.ok) {
    throw new SourceAccessDeniedError(`platform returned HTTP ${res.status}`, sourceId, `http_${res.status}`);
  }

  const html = await res.text();
  if (isChallengePage(html)) {
    throw new SourceAccessDeniedError(
      "platform served an anti-bot challenge instead of content",
      sourceId,
      "bot_challenge",
    );
  }
  return html;
}

/** First `content` of a meta tag matching either `property` or `name`. */
export function metaContent(html: string, key: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "i",
  );
  const tag = pattern.exec(html)?.[0];
  if (!tag) return null;
  return /content=["']([^"']*)["']/i.exec(tag)?.[1] ?? null;
}

/**
 * Every image a page offers for an event, ranked by how event-specific it
 * is rather than by where it happened to appear.
 *
 * The distinction that matters: JSON-LD `image` on an Event node is the
 * artwork the publisher attached *to that event*. An `og:image` is
 * whatever the page wants in a link preview, which for a listing page is
 * often the venue's logo. Both are worth keeping; only the first claims to
 * be the flyer.
 */
export function assetsFromPage(html: string, opts: { isOfficial: boolean }): AssetCandidate[] {
  const out: AssetCandidate[] = [];
  const seen = new Set<string>();

  const push = (url: string | null | undefined, candidate: Omit<AssetCandidate, "sourceUrl">) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ sourceUrl: url, ...candidate });
  };

  for (const node of extractJsonLdEvents(html)) {
    const image = node.image;
    const first = typeof image === "string" ? image : Array.isArray(image) ? image[0] : image?.url;
    push(typeof first === "string" ? first : null, {
      origin: "jsonld",
      isOfficial: opts.isOfficial,
      confidence: 0.9,
    });
  }

  push(metaContent(html, "og:image"), {
    origin: "opengraph",
    // An og:image is the page's link preview, not necessarily this event's
    // artwork — it is real imagery but a weaker claim.
    isOfficial: opts.isOfficial,
    confidence: 0.55,
  });
  push(metaContent(html, "twitter:image"), {
    origin: "opengraph",
    isOfficial: opts.isOfficial,
    confidence: 0.5,
  });

  return out;
}

/** Absolute URLs matching a path pattern, linked from a listing page. */
export function extractLinks(html: string, baseUrl: string, pathPattern: RegExp): string[] {
  const out = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/g)) {
    const href = match[1]!;
    if (!pathPattern.test(href)) continue;
    try {
      const resolved = new URL(href, baseUrl);
      resolved.hash = "";
      out.add(resolved.toString());
    } catch {
      // malformed href — skip rather than fail the page
    }
  }
  return [...out];
}

/**
 * Turns one event page into a DiscoveredEvent, keyed on a platform-stable
 * id so the same event arriving from a listing crawl, an admin-supplied
 * URL and a venue link in the entity graph stays one row.
 */
export function eventFromStructuredPage(
  url: string,
  html: string,
  opts: { platform: string; externalId: string },
): DiscoveredEvent | null {
  const nodes: JsonLdEventLike[] = extractJsonLdEvents(html);
  const node = nodes[0];
  if (!node) return null;

  const item = jsonLdToDiscoveredItem(node, url);
  return {
    ...item,
    externalId: opts.externalId,
    sourceUrl: url,
    mediaUrl: item.mediaUrl ?? metaContent(html, "og:image"),
    rawMetadata: { ...item.rawMetadata, platform: opts.platform },
  };
}
