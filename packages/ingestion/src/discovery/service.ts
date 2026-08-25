import type { AdapterType, EntityType } from "@college-events/core";
import { fingerprintPage, fingerprintUrl, AUTO_APPROVE_CONFIDENCE, type Fingerprint } from "../fingerprint.js";
import { buildDiscoveryQueries, type DiscoveryQuery, type UniversityProfile } from "./queries.js";
import { nullDiscoveryProvider, type WebDiscoveryProvider } from "./provider.js";

/**
 * UniversitySourceDiscoveryService — turns a university record into a list
 * of reviewable source candidates.
 *
 * The service is provider-agnostic and deliberately does not create
 * sources. Search results are *evidence*: plausible, frequently wrong, and
 * occasionally another city's venue with a similar name. A wrong source
 * pollutes a university's calendar quietly, which is worse than a missing
 * one, so everything lands as a candidate carrying its fingerprint and the
 * reasons behind it.
 */

export interface DiscoveredSourceCandidate {
  name: string;
  url: string;
  detectedAdapter: AdapterType;
  detectedEntityType: EntityType;
  confidence: number;
  evidence: string[];
  discoveryMethod: string;
  coverageCategory: string;
  /** True when confidence alone is enough to skip human review. */
  autoApprovable: boolean;
}

export interface DiscoveryRunSummary {
  queriesRun: number;
  resultsSeen: number;
  candidates: DiscoveredSourceCandidate[];
  /** Categories that produced nothing — the actionable half of the report. */
  categoriesWithNoResults: string[];
  provider: string;
}

export interface DiscoveryOptions {
  provider?: WebDiscoveryProvider;
  /** Fetch each candidate to fingerprint the real page. Off for a fast
   * first pass; on when accuracy matters more than time. */
  fetchPages?: boolean;
  fetchImpl?: typeof fetch;
  /** Cap results considered per query. */
  maxResultsPerQuery?: number;
  /** Cap total candidates, so one broad query cannot flood a review queue. */
  maxCandidates?: number;
  /** URLs already registered as sources — skipped rather than re-proposed. */
  knownUrls?: Iterable<string>;
  signal?: AbortSignal;
  /**
   * Fired the moment each candidate is finalized, before `discover()`
   * returns the full summary.
   *
   * A full run makes dozens of sequential external requests and can take
   * minutes — long enough that a caller running inside a time-boxed
   * environment (a serverless function with a hard duration limit) may
   * have its connection cut before `discover()` ever returns. Without
   * this, a run killed at candidate 40 of 50 loses all 40, because nothing
   * was persisted until the very end. A caller that persists here instead
   * keeps whatever was found up to the cutoff.
   *
   * Errors thrown here are swallowed rather than aborting the run — a
   * failure to persist one candidate should not cost the rest of the
   * search.
   */
  onCandidate?: (candidate: DiscoveredSourceCandidate) => void | Promise<void>;
}

/** Normalized form used to tell "already known" from "new". */
export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.host = parsed.host.toLowerCase().replace(/^www\./, "");
    // Tracking parameters make identical URLs look distinct, which would
    // let the same page enter the review queue several times.
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(key)) parsed.searchParams.delete(key);
    }
    // Root path collapses to empty so "https://x.edu" and "https://x.edu/"
    // are one key, consistent with how deeper paths are trimmed.
    const path = parsed.pathname.replace(/\/+$/, "");
    const search = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.host}${path}${search ? `?${search}` : ""}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * A search result that is obviously not an event source. Filtering these
 * before fingerprinting keeps the review queue readable — a reviewer who
 * has to reject twenty PDFs and login pages stops reviewing carefully.
 */
export function isPlausibleSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|zip|mp4)$/i.test(parsed.pathname)) return false;
    if (/\/(login|signin|sign-in|register|privacy|terms|accessibility)(\/|$)/i.test(parsed.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a result really came from the university's own web presence.
 *
 * A `site:` query is a request, not a guarantee — providers return
 * off-domain results routinely, and a third-party page answering "student
 * government events" is usually a news article about the university rather
 * than its calendar.
 *
 * This is a signal, not a veto: see `shouldKeepOffDomain`.
 */
export function isFirstParty(url: string, primaryDomain: string | null): boolean {
  if (!primaryDomain) return true; // nothing to check against
  try {
    const host = new URL(url).host.toLowerCase();
    return host === primaryDomain || host.endsWith(`.${primaryDomain}`);
  } catch {
    return false;
  }
}

/**
 * Whether to keep an off-domain result that came from a first-party query.
 *
 * Dropping all of them is wrong, and was the first thing this got wrong:
 * a university's athletics site is almost never on the university's domain
 * (ucfknights.com, fausports.com), and neither are its ticket office or
 * performing-arts venue. Those are exactly the sources we most want.
 *
 * What separates them from a news article is that they run on a
 * *recognised event platform*. A SIDEARM athletics site or a Localist
 * calendar is an event source wherever it is hosted; an unidentifiable
 * page that a `site:` query returned from someone else's domain is noise.
 */
export function shouldKeepOffDomain(adapterType: AdapterType): boolean {
  return adapterType !== "generic_web";
}

/**
 * Whether an off-domain host looks like it belongs to the university.
 *
 * The athletics case again: ucfknights.com, fausports.com, gozips.com. A
 * platform fingerprint proves it, but only if the page was fetched — and
 * the first discovery pass deliberately does not fetch. The naming is the
 * remaining signal, and it is a real one: these domains are built out of
 * the school's own short name or mascot wording.
 *
 * Kept deliberately narrow. It admits a candidate to a review queue; it
 * never approves one.
 */
export function looksAffiliated(url: string, university: UniversityProfile): boolean {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  const shortName = university.shortName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (shortName.length >= 2 && host.includes(shortName)) return true;

  // Distinctive words from the full name — "central", "atlantic" — while
  // ignoring the ones every university shares.
  const generic = new Set(["university", "college", "state", "the", "of", "and", "institute", "school"]);
  return university.name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 5 && !generic.has(word))
    .some((word) => host.includes(word));
}

function titleFor(result: { title: string; url: string }): string {
  const title = result.title.trim();
  if (title) return title.slice(0, 200);
  try {
    return new URL(result.url).host;
  } catch {
    return result.url.slice(0, 200);
  }
}

export class UniversitySourceDiscoveryService {
  constructor(
    private readonly provider: WebDiscoveryProvider = nullDiscoveryProvider,
    private readonly options: DiscoveryOptions = {},
  ) {}

  /**
   * Run the full query set for a university and return candidates.
   *
   * Never throws for a failing query. Discovery inspects a lot of
   * unfamiliar hosts and one bad query must not cost the whole run — a
   * partially-discovered university is useful, an aborted run is not.
   */
  async discover(
    university: UniversityProfile,
    options: DiscoveryOptions = {},
  ): Promise<DiscoveryRunSummary> {
    const opts = { ...this.options, ...options };
    const provider = opts.provider ?? this.provider;
    const maxResults = opts.maxResultsPerQuery ?? 10;
    const maxCandidates = opts.maxCandidates ?? 200;

    const known = new Set([...(opts.knownUrls ?? [])].map(canonicalizeUrl));
    const byUrl = new Map<string, DiscoveredSourceCandidate>();
    const categoriesWithResults = new Set<string>();

    const queries = buildDiscoveryQueries(university);
    let resultsSeen = 0;

    for (const q of queries) {
      if (byUrl.size >= maxCandidates) break;
      let results: { title: string; url: string; snippet?: string }[];
      try {
        results = (await provider.search(q.query)).slice(0, maxResults);
      } catch {
        // A provider erroring on one query says nothing about the others.
        continue;
      }
      resultsSeen += results.length;

      for (const result of results) {
        if (byUrl.size >= maxCandidates) break;
        const candidate = await this.evaluate(result, q, university, opts, known, byUrl);
        if (candidate) categoriesWithResults.add(q.coverageCategory);
      }
    }

    const allCategories = new Set(queries.map((q) => q.coverageCategory));
    return {
      queriesRun: queries.length,
      resultsSeen,
      candidates: [...byUrl.values()].sort((a, b) => b.confidence - a.confidence),
      categoriesWithNoResults: [...allCategories].filter((c) => !categoriesWithResults.has(c)),
      provider: provider.name,
    };
  }

  private async evaluate(
    result: { title: string; url: string; snippet?: string },
    query: DiscoveryQuery,
    university: UniversityProfile,
    opts: DiscoveryOptions,
    known: Set<string>,
    byUrl: Map<string, DiscoveredSourceCandidate>,
  ): Promise<DiscoveredSourceCandidate | null> {
    if (!isPlausibleSourceUrl(result.url)) return null;

    const canonical = canonicalizeUrl(result.url);
    if (known.has(canonical)) return null; // already a source

    let fingerprint: Fingerprint;
    if (opts.fetchPages) {
      fingerprint = await fingerprintPage(result.url, opts.fetchImpl ?? fetch, opts.signal);
    } else {
      fingerprint = fingerprintUrl(result.url);
    }

    const offDomain =
      query.query.startsWith("site:") &&
      university.primaryDomain !== null &&
      !isFirstParty(result.url, university.primaryDomain);
    // Off-domain results are kept when something vouches for them: either a
    // recognised platform, or a host named after the university. Everything
    // else from a site: query is third-party coverage *about* the school
    // rather than the school's own calendar.
    if (offDomain && !shouldKeepOffDomain(fingerprint.adapterType) && !looksAffiliated(result.url, university)) {
      return null;
    }

    // A page that merely *links* an RSS/iCal alternate is not itself the
    // feed — the rss/ical adapters fetch this URL and parse it as that
    // format, so pointing them at the page would get HTML back and find
    // nothing, forever, without ever raising an error. Crawl the feed the
    // page told us about instead of the page we happened to find.
    const effectiveUrl = fingerprint.feedUrl ? canonicalizeUrl(fingerprint.feedUrl) : canonical;
    if (effectiveUrl !== canonical && known.has(effectiveUrl)) return null; // already a source

    const existing = byUrl.get(effectiveUrl);
    // The same URL can answer several queries. Keep the best-evidenced
    // reading rather than whichever query happened to run last.
    if (existing && existing.confidence >= fingerprint.confidence) return existing;

    const candidate: DiscoveredSourceCandidate = {
      name: titleFor(result),
      url: effectiveUrl,
      detectedAdapter: fingerprint.adapterType,
      detectedEntityType: query.entityType,
      confidence: fingerprint.confidence,
      evidence: [
        `found by ${query.coverageCategory} query: ${query.query}`,
        ...fingerprint.evidence,
        ...(effectiveUrl !== canonical ? [`resolved to its feed at ${effectiveUrl}`] : []),
        ...(offDomain
          ? [
              `off ${university.primaryDomain} — kept because ${
                shouldKeepOffDomain(fingerprint.adapterType)
                  ? `it runs on ${fingerprint.adapterType}`
                  : "the host is named after the university"
              }; needs review`,
            ]
          : []),
      ],
      discoveryMethod: "search",
      coverageCategory: query.coverageCategory,
      // Auto-approval requires a confident *platform* match, and a
      // first-party result. An off-domain find is exactly the case where a
      // human should confirm we found the university's athletics site and
      // not a rival's.
      autoApprovable:
        fingerprint.confidence >= AUTO_APPROVE_CONFIDENCE &&
        fingerprint.adapterType !== "generic_web" &&
        !offDomain,
    };

    byUrl.set(effectiveUrl, candidate);
    if (opts.onCandidate) {
      try {
        await opts.onCandidate(candidate);
      } catch {
        // See the doc comment on `onCandidate`: one bad write must not
        // abort a search that has more candidates left to find.
      }
    }
    return candidate;
  }
}
