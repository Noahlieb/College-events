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
import { IngestionError } from "./types.js";
import { fetchIcsEvents, toDiscoveredItem as icsToDiscoveredItem } from "./ical.js";

/**
 * CampusLabs / Anthology Engage — the student-engagement platform behind
 * FAU's "Owl Central", UCF's "Knight Connect" and several hundred other
 * campuses. Every install exposes the same discovery API under its own
 * subdomain, which is why this is one adapter and not one scraper per
 * school: the only school-specific facts are the host and (optionally) a
 * branch filter, and both live in `source.config`.
 *
 * This replaces the previous `scrape_owlcentral.py → CSV → import-csv`
 * route. That path worked, but CSV as the automated boundary meant the
 * pipeline could only run where a Python cron ran, and every field had to
 * survive a lossy round-trip through flat text. The API is hit directly.
 *
 * Config (all optional except `host`):
 * ```jsonc
 * {
 *   "host": "fau.campuslabs.com",  // required unless discoveryUrl is set
 *   "lookaheadDays": 45,           // how far forward to ask for
 *   "pageSize": 100,
 *   "status": "Approved",          // Engage's own moderation state
 *   "icsFallbackUrl": "https://…/events.ics"
 * }
 * ```
 */

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_LOOKAHEAD_DAYS = 45;
const IMAGE_CDN = "https://se-images.campuslabs.com/clink/images";

interface EngageEvent {
  id?: number | string;
  name?: string | null;
  description?: string | null;
  organizationName?: string | null;
  organizationProfilePicture?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  location?: string | null;
  theme?: string | null;
  categoryNames?: string[] | null;
  rsvpTotal?: number | null;
  imagePath?: string | null;
  benefitNames?: string[] | null;
}

interface EngageSearchResponse {
  value?: EngageEvent[];
  "@odata.count"?: number;
}

/** Engage stores descriptions as HTML fragments; raw_text wants plain text. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n") // paragraph break, not a line break
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Absolute CDN URL for an Engage image path, or null when there is none. */
export function engageImageUrl(path: string | null | undefined, preset = "large-sq"): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${IMAGE_CDN}/${path}?preset=${preset}`;
}

/** Resolves the API host from explicit config or from a configured URL. */
export function resolveHost(source: SourceInstance): string | null {
  const configured = source.config.host;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  const candidate = source.discoveryUrl ?? source.url;
  if (!candidate) return null;
  try {
    return new URL(candidate).host;
  } catch {
    return null;
  }
}

export function searchUrl(
  host: string,
  params: { skip: number; take: number; endsAfter: string; startsBefore: string; status: string },
): string {
  const query = new URLSearchParams({
    orderByField: "startsOn",
    orderByDirection: "ascending",
    status: params.status,
    endsAfter: params.endsAfter,
    startsBefore: params.startsBefore,
    skip: String(params.skip),
    take: String(params.take),
  });
  return `https://${host}/engage/api/discovery/event/search?${query.toString()}`;
}

export function toDiscoveredEvent(host: string, event: EngageEvent): DiscoveredEvent | null {
  if (event.id == null) return null;
  const name = (event.name ?? "").trim();
  if (!name) return null;

  const organization = (event.organizationName ?? "").trim();
  const description = stripHtml(event.description);
  const textParts = [
    name,
    organization ? `Hosted by: ${organization}` : null,
    event.startsOn ? `Start: ${event.startsOn}` : null,
    event.endsOn ? `End: ${event.endsOn}` : null,
    event.location ? `Location: ${event.location}` : null,
    description || null,
  ].filter(Boolean);

  return {
    externalId: `campuslabs-${host}-${event.id}`,
    sourceUrl: `https://${host}/engage/event/${event.id}`,
    rawText: textParts.join("\n"),
    mediaUrl: engageImageUrl(event.imagePath) ?? engageImageUrl(event.organizationProfilePicture),
    publishedAt: null,
    rawMetadata: {
      platform: "campuslabs",
      engageId: event.id,
      organization: organization || null,
      startsOn: event.startsOn ?? null,
      endsOn: event.endsOn ?? null,
      location: event.location ?? null,
      theme: event.theme ?? null,
      categories: event.categoryNames ?? [],
      rsvpTotal: event.rsvpTotal ?? null,
      perks: event.benefitNames ?? [],
      // Kept separate from imagePath so the flyer pipeline can tell an
      // event's own artwork from its host org's avatar — the latter is a
      // logo, not a flyer, and must not outrank real event art.
      imagePath: event.imagePath ?? null,
      organizationProfilePicture: event.organizationProfilePicture ?? null,
    },
  };
}

/**
 * A challenge/refusal is reported as DEGRADED, never retried harder. A
 * 5xx or a network fault is an ordinary failure and stays an
 * IngestionError so it can be retried on the next scheduled run.
 */
function classifyHttpFailure(status: number, url: string, sourceId: string): Error {
  if (status === 401 || status === 403 || status === 429 || status === 503) {
    return new SourceAccessDeniedError(
      `CampusLabs refused automated access (HTTP ${status})`,
      sourceId,
      `http_${status}`,
    );
  }
  return new IngestionError(`CampusLabs search failed: HTTP ${status} (${url})`, sourceId);
}

async function fetchPage(
  url: string,
  fetchImpl: typeof fetch,
  sourceId: string,
  signal?: AbortSignal,
): Promise<EngageSearchResponse> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw classifyHttpFailure(res.status, url, sourceId);
  return (await res.json()) as EngageSearchResponse;
}

export const campusLabsAdapter: EventSourceAdapter = {
  type: "campuslabs",
  capabilities: { discovery: true, details: false, assets: true, incremental: false },

  async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
    const host = resolveHost(source);
    if (!host) {
      throw new IngestionError(
        "CampusLabs source needs a `host` in config or a URL to derive it from",
        source.id,
      );
    }
    const fetchImpl = context.fetchImpl ?? fetch;
    const now = context.now ?? new Date();
    const lookaheadDays =
      context.lookaheadDays ?? numberConfig(source, "lookaheadDays", DEFAULT_LOOKAHEAD_DAYS);
    const pageSize = numberConfig(source, "pageSize", DEFAULT_PAGE_SIZE);
    const status = typeof source.config.status === "string" ? source.config.status : "Approved";

    const endsAfter = now.toISOString().replace(/\.\d+Z$/, ".000Z");
    const startsBefore = new Date(now.getTime() + lookaheadDays * 86_400_000)
      .toISOString()
      .replace(/\.\d+Z$/, ".000Z");

    const items: DiscoveredEvent[] = [];
    let skip = 0;
    let total: number | null = null;

    try {
      // Paginate to the API's own reported total. The old ICS feed was
      // page-capped, which is why the richer endpoint is preferred.
      while (true) {
        const url = searchUrl(host, { skip, take: pageSize, endsAfter, startsBefore, status });
        const data = await fetchPage(url, fetchImpl, source.id, context.signal);
        total ??= data["@odata.count"] ?? 0;
        const batch = data.value ?? [];
        if (batch.length === 0) break;

        for (const event of batch) {
          const item = toDiscoveredEvent(host, event);
          if (item) items.push(item);
          if (context.maxItems && items.length >= context.maxItems) return items;
        }
        skip += batch.length;
        if (skip >= total) break;
      }
    } catch (err) {
      // Structured endpoint → iCal is the documented fallback order. A
      // partial page set is still worth keeping; the fallback only runs
      // when the API produced nothing at all.
      const icsFallback = source.config.icsFallbackUrl;
      if (items.length === 0 && typeof icsFallback === "string" && icsFallback) {
        const events = await fetchIcsEvents(icsFallback, fetchImpl);
        const fallbackItems = events.map(icsToDiscoveredItem);
        return context.maxItems ? fallbackItems.slice(0, context.maxItems) : fallbackItems;
      }
      if (items.length === 0) throw err;
    }

    return items;
  },

  /**
   * Engage carries two images per event and they are not equivalent: the
   * event's own `imagePath` is real flyer art, while
   * `organizationProfilePicture` is the host org's logo. Both are offered,
   * but only the former claims to be the official flyer — otherwise every
   * event a club posts would "have a flyer" that is just the club's badge.
   */
  async discoverAssets(
    _source: SourceInstance,
    event: RawEventPayload,
  ): Promise<AssetCandidate[]> {
    const meta = event.rawMetadata ?? {};
    const out: AssetCandidate[] = [];

    const flyer = engageImageUrl(meta.imagePath as string | null);
    if (flyer) {
      out.push({ sourceUrl: flyer, origin: "api", isOfficial: true, confidence: 0.9 });
    }
    const orgAvatar = engageImageUrl(meta.organizationProfilePicture as string | null);
    if (orgAvatar && orgAvatar !== flyer) {
      out.push({ sourceUrl: orgAvatar, origin: "organizer", isOfficial: false, confidence: 0.3 });
    }
    return out;
  },

  async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
    const host = resolveHost(source);
    const checkedAt = context.now ?? new Date();
    if (!host) {
      return { status: "failed", reason: "no host configured", checkedAt };
    }
    const fetchImpl = context.fetchImpl ?? fetch;
    const probe = searchUrl(host, {
      skip: 0,
      take: 1,
      endsAfter: checkedAt.toISOString(),
      startsBefore: new Date(checkedAt.getTime() + 86_400_000).toISOString(),
      status: "Approved",
    });
    try {
      await fetchPage(probe, fetchImpl, source.id, context.signal);
      return { status: "healthy", checkedAt };
    } catch (err) {
      if (err instanceof SourceAccessDeniedError) {
        return { status: "degraded", reason: err.message, checkedAt };
      }
      return { status: "failed", reason: (err as Error).message, checkedAt };
    }
  },
};

function numberConfig(source: SourceInstance, key: string, fallback: number): number {
  const value = source.config[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
