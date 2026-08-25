import type { SearchResult, WebDiscoveryProvider } from "../provider.js";

/**
 * Shared plumbing for HTTP-backed search providers.
 *
 * Every provider needs the same three things and gets them wrong in the
 * same three ways: a timeout (a hung search must not hang a discovery run
 * that has sixty more queries to make), backoff on rate limits (search
 * APIs meter aggressively and a burst of 60 queries will hit it), and a
 * failure mode that returns nothing rather than throwing.
 *
 * That last one is a deliberate contract: discovery is a safety net over a
 * source registry that already works. A provider outage should mean "we
 * learned nothing new today", never "the pipeline is down".
 */

export interface HttpProviderOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Search APIs occasionally hang rather than error. */
  timeoutMs?: number;
  /** Retries on 429/5xx, with exponential backoff. */
  maxRetries?: number;
  /** Results requested per query. */
  count?: number;
}

export class SearchProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SearchProviderError";
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * One GET with timeout, retry and backoff.
 *
 * `sleep` is injectable so tests can assert the retry behaviour without
 * actually waiting — otherwise nobody writes the retry test.
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxRetries = options.maxRetries ?? 2;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // 400ms, 800ms, 1600ms — enough to clear a per-second quota without
      // stalling a run that still has dozens of queries to make.
      await sleep(400 * 2 ** (attempt - 1));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      if (res.ok) return (await res.json()) as T;

      const error = new SearchProviderError(
        `search provider returned HTTP ${res.status}`,
        res.status,
      );
      if (!RETRYABLE.has(res.status)) throw error;
      lastError = error;
    } catch (err) {
      if (err instanceof SearchProviderError && !RETRYABLE.has(err.status ?? 0)) throw err;
      lastError = err as Error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new SearchProviderError("search provider failed");
}

/**
 * Wraps a provider so a failing query yields no results instead of
 * propagating. The discovery service already tolerates a throwing query,
 * but doing it here means every provider gets the behaviour for free and
 * the failure is logged once, in one place.
 */
export function resilient(provider: WebDiscoveryProvider): WebDiscoveryProvider {
  return {
    name: provider.name,
    async search(query: string): Promise<SearchResult[]> {
      try {
        return await provider.search(query);
      } catch (err) {
        console.warn(`[discovery] ${provider.name} failed for "${query}": ${(err as Error).message}`);
        return [];
      }
    },
  };
}
