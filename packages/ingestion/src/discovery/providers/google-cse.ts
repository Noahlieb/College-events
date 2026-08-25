import type { SearchResult, WebDiscoveryProvider } from "../provider.js";
import { fetchJsonWithRetry, type HttpProviderOptions } from "./http.js";

/**
 * Google Programmable Search (Custom Search JSON API).
 *
 * A second first-party provider, present mainly to keep the abstraction
 * honest: an interface with one implementation is a guess about what
 * varies, and this one proves the discovery engine really does not care
 * which index answers.
 *
 * It is also the better provider for the first-party half of discovery —
 * a Programmable Search engine can be configured to a university's domain,
 * which makes `site:` queries authoritative rather than advisory.
 */

interface CseItem {
  title?: string;
  link?: string;
  snippet?: string;
}

interface CseResponse {
  items?: CseItem[];
  error?: { message?: string };
}

export interface GoogleCseOptions extends HttpProviderOptions {
  /** The Programmable Search engine id (`cx`). */
  engineId: string;
}

export class GoogleCseDiscoveryProvider implements WebDiscoveryProvider {
  readonly name = "google_cse";
  private readonly options: GoogleCseOptions;

  constructor(options: GoogleCseOptions) {
    this.options = options;
  }

  async search(query: string): Promise<SearchResult[]> {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", this.options.apiKey);
    url.searchParams.set("cx", this.options.engineId);
    url.searchParams.set("q", query);
    // The API caps `num` at 10 per request; asking for more is an error
    // rather than a truncation.
    url.searchParams.set("num", String(Math.min(this.options.count ?? 10, 10)));

    const body = await fetchJsonWithRetry<CseResponse>(
      url.toString(),
      { headers: { Accept: "application/json" } },
      {
        fetchImpl: this.options.fetchImpl,
        timeoutMs: this.options.timeoutMs,
        maxRetries: this.options.maxRetries,
      },
    );

    return (body.items ?? [])
      .filter((i): i is CseItem & { link: string } => typeof i.link === "string" && i.link.length > 0)
      .map((i) => ({ title: i.title ?? "", url: i.link, snippet: i.snippet }));
  }
}
