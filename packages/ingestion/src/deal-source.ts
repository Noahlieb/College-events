import { createHash } from "node:crypto";

export class DealIngestionError extends Error {
  constructor(
    message: string,
    public readonly sourceUrl: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DealIngestionError";
  }
}

export interface DealSourceFetchContext {
  url: string;
  /** The merchant_sources.content_hash from the previous check, or null on
   * a source's first-ever check. */
  previousHash: string | null;
  /** Injectable for testing / custom fetch behavior. */
  fetchImpl?: typeof fetch;
}

export interface DealSourceFetchResult {
  changed: boolean;
  contentHash: string;
  normalizedText: string;
  fetchedAt: string;
}

/** Strips script/style/comments/markup down to plain text, collapsing
 * whitespace — the "normalize the useful page text" step (spec Phase 4)
 * that change detection hashes, so a script's cache-buster query string or
 * a comment timestamp never causes a false "changed" every single check. */
export function normalizePageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Static-fetch source adapter for merchant deal pages (spec Phase 3/4):
 * fetches a page, normalizes its text, and hashes it. Callers compare the
 * returned hash to `merchant_sources.content_hash` — unchanged content
 * means the pipeline stops there and never reaches the LLM (spec: "do not
 * send every page to an LLM every time").
 *
 * Deliberately does not render JavaScript, follow redirects into a login
 * wall, or attempt to defeat bot detection — a page that doesn't yield
 * useful text through a plain fetch should be marked `scrapingMethod:
 * "manual"` on its merchant_sources row instead (spec Phase 3's explicit
 * "flag it MANUAL_SOURCE rather than trying to defeat protections").
 */
export async function fetchDealSource(ctx: DealSourceFetchContext): Promise<DealSourceFetchResult> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(ctx.url, { headers: { Accept: "text/html" } });
  } catch (err) {
    throw new DealIngestionError(`Fetch failed: ${(err as Error).message}`, ctx.url, err);
  }
  if (!res.ok) {
    throw new DealIngestionError(`Webpage fetch failed: HTTP ${res.status}`, ctx.url);
  }
  const html = await res.text();
  const normalizedText = normalizePageText(html);
  const contentHash = createHash("sha256").update(normalizedText).digest("hex");

  return {
    changed: contentHash !== ctx.previousHash,
    contentHash,
    normalizedText,
    fetchedAt: new Date().toISOString(),
  };
}
