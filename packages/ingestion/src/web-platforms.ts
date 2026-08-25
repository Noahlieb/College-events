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
import { parseIcs, toDiscoveredItem as icsToDiscoveredItem } from "./ical.js";
import { assetsFromPage, fetchStructuredPage } from "./structured-page.js";

/**
 * WordPress and Google Calendar — the two platforms most likely to be
 * behind a small venue's or a department's calendar.
 *
 * Neither needed a bespoke integration so much as a way to reach the
 * structured endpoint each already publishes.
 */

function stringConfig(source: SourceInstance, key: string): string | null {
  const value = source.config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ── WordPress ──────────────────────────────────────────────────────

interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
}

interface TribeEvent {
  id?: number;
  title?: string;
  description?: string;
  excerpt?: string;
  url?: string;
  start_date?: string;
  end_date?: string;
  cost?: string;
  image?: { url?: string; sizes?: Record<string, { url?: string; width?: number; height?: number }> } | false;
  venue?: TribeVenue | [];
  organizer?: { organizer?: string }[] | [];
}

interface TribeResponse {
  events?: TribeEvent[];
  next_rest_url?: string | null;
  total_pages?: number;
}

function stripTags(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Largest declared size of a Tribe image — the flyer pipeline wants the original. */
export function largestTribeImage(image: TribeEvent["image"]): { url: string; width?: number; height?: number } | null {
  if (!image || typeof image !== "object") return null;
  let best: { url: string; width?: number; height?: number } | null = image.url
    ? { url: image.url }
    : null;
  for (const size of Object.values(image.sizes ?? {})) {
    if (!size?.url) continue;
    const area = (size.width ?? 0) * (size.height ?? 0);
    const bestArea = (best?.width ?? 0) * (best?.height ?? 0);
    if (!best || area > bestArea) best = { url: size.url, width: size.width, height: size.height };
  }
  return best;
}

export function tribeToDiscovered(host: string, event: TribeEvent): DiscoveredEvent | null {
  if (event.id == null || !event.title) return null;
  const venue = Array.isArray(event.venue) ? null : event.venue;
  const organizer = Array.isArray(event.organizer) ? event.organizer[0]?.organizer : null;
  const image = largestTribeImage(event.image);

  return {
    externalId: `wordpress-${host}-${event.id}`,
    sourceUrl: event.url ?? null,
    rawText: [
      stripTags(event.title),
      organizer ? `Hosted by: ${organizer}` : null,
      event.start_date ? `Start: ${event.start_date}` : null,
      event.end_date ? `End: ${event.end_date}` : null,
      venue?.venue ? `Location: ${[venue.venue, venue.address, venue.city].filter(Boolean).join(", ")}` : null,
      event.cost ? `Cost: ${event.cost}` : null,
      stripTags(event.description ?? event.excerpt) || null,
    ]
      .filter(Boolean)
      .join("\n"),
    mediaUrl: image?.url ?? null,
    publishedAt: null,
    rawMetadata: {
      platform: "wordpress",
      wordpressId: event.id,
      startsOn: event.start_date ?? null,
      endsOn: event.end_date ?? null,
      venue: venue?.venue ?? null,
      address: venue?.address ?? null,
      city: venue?.city ?? null,
      organizer: organizer ?? null,
      cost: event.cost ?? null,
      imageUrl: image?.url ?? null,
      imageWidth: image?.width ?? null,
      imageHeight: image?.height ?? null,
    },
  };
}

/**
 * WordPress running The Events Calendar, which exposes a public REST
 * endpoint at `/wp-json/tribe/events/v1/events`. When a site has the
 * plugin this is far better than scraping its theme; when it does not, the
 * adapter says so rather than falling back to guesswork — a plain
 * WordPress site with no events plugin is a `jsonld`/`generic_web` source.
 */
export const wordpressAdapter: EventSourceAdapter = {
  type: "wordpress",
  capabilities: { discovery: true, details: false, assets: true, incremental: false },

  async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
    const base = stringConfig(source, "restBase") ?? source.discoveryUrl ?? source.url;
    if (!base) throw new IngestionError("WordPress source needs a URL", source.id);

    let origin: string;
    let host: string;
    try {
      const parsed = new URL(base);
      origin = parsed.origin;
      host = parsed.host;
    } catch {
      throw new IngestionError(`WordPress source has an unparseable URL: ${base}`, source.id);
    }

    const fetchImpl = context.fetchImpl ?? fetch;
    const perPage = 50;
    const items: DiscoveredEvent[] = [];
    let next: string | null = `${origin}/wp-json/tribe/events/v1/events?per_page=${perPage}&status=publish`;

    while (next) {
      const res = await fetchImpl(next, { headers: { Accept: "application/json" }, signal: context.signal });
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw new SourceAccessDeniedError(
          `WordPress declined automated access (HTTP ${res.status})`,
          source.id,
          `http_${res.status}`,
        );
      }
      if (res.status === 404) {
        throw new IngestionError(
          "No Events Calendar REST endpoint on this WordPress site — use a jsonld/generic_web source instead",
          source.id,
        );
      }
      if (!res.ok) throw new IngestionError(`WordPress API failed: HTTP ${res.status}`, source.id);

      const body = (await res.json()) as TribeResponse;
      const batch = body.events ?? [];
      if (batch.length === 0) break;

      for (const event of batch) {
        const item = tribeToDiscovered(host, event);
        if (item) items.push(item);
        if (context.maxItems && items.length >= context.maxItems) return items;
      }
      // The API hands back the next page URL; following it is more robust
      // than re-deriving offsets.
      next = body.next_rest_url ?? null;
    }

    return items;
  },

  async discoverAssets(
    source: SourceInstance,
    event: RawEventPayload,
    context: CrawlContext,
  ): Promise<AssetCandidate[]> {
    const out: AssetCandidate[] = [];
    const url = event.rawMetadata?.imageUrl;
    if (typeof url === "string" && url) {
      out.push({
        sourceUrl: url,
        origin: "api",
        isOfficial: true,
        confidence: 0.8,
        width: (event.rawMetadata?.imageWidth as number | null) ?? null,
        height: (event.rawMetadata?.imageHeight as number | null) ?? null,
      });
    }
    // The event page often carries a larger hero than the API's featured
    // image, so it is worth a look when we already have the URL.
    if (event.sourceUrl) {
      try {
        const html = await fetchStructuredPage(
          event.sourceUrl,
          source.id,
          context.fetchImpl ?? fetch,
          context.signal,
        );
        out.push(...assetsFromPage(html, { isOfficial: true }));
      } catch {
        // best-effort
      }
    }
    return out;
  },

  async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
    const checkedAt = context.now ?? new Date();
    try {
      await wordpressAdapter.discover(source, { ...context, maxItems: 1 });
      return { status: "healthy", checkedAt };
    } catch (err) {
      if (err instanceof SourceAccessDeniedError) {
        return { status: "degraded", reason: err.message, checkedAt };
      }
      return { status: "failed", reason: (err as Error).message, checkedAt };
    }
  },
};

// ── Google Calendar ────────────────────────────────────────────────

/**
 * A public Google Calendar's iCal address, derived from whatever form the
 * operator pasted — the embed URL, the calendar id, or the ics link
 * itself. People copy whichever one their browser was showing.
 */
export function googleCalendarIcsUrl(source: SourceInstance): string | null {
  const explicit = stringConfig(source, "icsUrl");
  if (explicit) return explicit;

  const calendarId = stringConfig(source, "calendarId");
  if (calendarId) {
    return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
  }

  const raw = source.discoveryUrl ?? source.url;
  if (!raw) return null;
  if (/\.ics(\?|$)/i.test(raw)) return raw;

  try {
    const parsed = new URL(raw);
    const src = parsed.searchParams.get("src");
    if (src) {
      return `https://calendar.google.com/calendar/ical/${encodeURIComponent(src)}/public/basic.ics`;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Public Google Calendars. There is no bespoke integration here on
 * purpose: a public calendar's supported machine-readable form is its iCal
 * feed, so this resolves the feed address and reuses the tested ICS parser.
 */
export const googleCalendarAdapter: EventSourceAdapter = {
  type: "google_calendar",
  capabilities: { discovery: true, details: false, assets: false, incremental: false },

  async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
    const icsUrl = googleCalendarIcsUrl(source);
    if (!icsUrl) {
      throw new IngestionError(
        "Google Calendar source needs `calendarId`, `icsUrl`, or a calendar URL containing `src`",
        source.id,
      );
    }
    const res = await (context.fetchImpl ?? fetch)(icsUrl, {
      headers: { Accept: "text/calendar" },
      signal: context.signal,
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      // A private calendar is not a bug; it is a calendar we are not
      // permitted to read, and no amount of retrying changes that.
      throw new SourceAccessDeniedError(
        `Google Calendar is not public (HTTP ${res.status})`,
        source.id,
        `http_${res.status}`,
      );
    }
    if (!res.ok) throw new IngestionError(`Google Calendar fetch failed: HTTP ${res.status}`, source.id);

    const items = parseIcs(await res.text()).map(icsToDiscoveredItem);
    return context.maxItems ? items.slice(0, context.maxItems) : items;
  },

  async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
    const checkedAt = context.now ?? new Date();
    try {
      await googleCalendarAdapter.discover(source, { ...context, maxItems: 1 });
      return { status: "healthy", checkedAt };
    } catch (err) {
      if (err instanceof SourceAccessDeniedError) {
        return { status: "degraded", reason: err.message, checkedAt };
      }
      return { status: "failed", reason: (err as Error).message, checkedAt };
    }
  },
};
