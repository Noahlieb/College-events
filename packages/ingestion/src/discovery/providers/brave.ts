import type { SearchResult, WebDiscoveryProvider } from "../provider.js";
import { fetchJsonWithRetry, type HttpProviderOptions } from "./http.js";

/**
 * Brave Search API.
 *
 * Chosen as the default production provider because it is a first-party
 * licensed index with a documented API and a free tier — as opposed to the
 * SERP-reseller services, which obtain their results by scraping another
 * engine. Discovery runs dozens of queries per university on a schedule,
 * so the legitimacy of that access matters more here than the price does.
 *
 * Everything vendor-specific is in this file. The discovery engine never
 * imports it; it receives a `WebDiscoveryProvider`.
 */

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

export class BraveDiscoveryProvider implements WebDiscoveryProvider {
  readonly name = "brave";
  private readonly options: HttpProviderOptions;

  constructor(options: HttpProviderOptions) {
    this.options = options;
  }

  async search(query: string): Promise<SearchResult[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(this.options.count ?? 10));
    // Discovery wants pages that exist, not news chatter about them.
    url.searchParams.set("result_filter", "web");

    const body = await fetchJsonWithRetry<BraveResponse>(
      url.toString(),
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.options.apiKey,
        },
      },
      {
        fetchImpl: this.options.fetchImpl,
        timeoutMs: this.options.timeoutMs,
        maxRetries: this.options.maxRetries,
      },
    );

    return (body.web?.results ?? [])
      .filter((r): r is BraveWebResult & { url: string } => typeof r.url === "string" && r.url.length > 0)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url,
        snippet: r.description,
      }));
  }
}
