/**
 * Web discovery is pluggable on purpose.
 *
 * Finding a university's event ecosystem needs a search index, and which
 * index that is will change — an API key appears, a contract lapses, a
 * self-hosted crawler gets built. Binding the discovery engine to one
 * vendor would make every such change a rewrite, so the engine only ever
 * sees this interface. No paid provider is wired in; there is a fixture
 * provider for tests and development, and a real one drops in behind the
 * same three lines.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebDiscoveryProvider {
  /** Short identifier recorded on candidates for provenance. */
  readonly name: string;
  search(query: string): Promise<SearchResult[]>;
}

/**
 * Used when no provider is configured. Returns nothing rather than
 * throwing: discovery is a safety net over a source registry that already
 * works, so its absence must degrade the system, not break it.
 */
export const nullDiscoveryProvider: WebDiscoveryProvider = {
  name: "none",
  async search(): Promise<SearchResult[]> {
    return [];
  },
};

/**
 * Fixture-backed provider for tests and local development. Queries are
 * matched by substring so a fixture can answer a family of related
 * queries without restating them.
 */
export class FixtureDiscoveryProvider implements WebDiscoveryProvider {
  readonly name = "fixture";
  private readonly fixtures: { match: string; results: SearchResult[] }[];
  /** Every query it was asked — lets a test assert on query generation. */
  readonly queriesSeen: string[] = [];

  constructor(fixtures: Record<string, SearchResult[]>) {
    this.fixtures = Object.entries(fixtures).map(([match, results]) => ({
      match: match.toLowerCase(),
      results,
    }));
  }

  async search(query: string): Promise<SearchResult[]> {
    this.queriesSeen.push(query);
    const normalized = query.toLowerCase();
    const out: SearchResult[] = [];
    const seen = new Set<string>();
    for (const fixture of this.fixtures) {
      if (!normalized.includes(fixture.match)) continue;
      for (const result of fixture.results) {
        if (seen.has(result.url)) continue;
        seen.add(result.url);
        out.push(result);
      }
    }
    return out;
  }
}
