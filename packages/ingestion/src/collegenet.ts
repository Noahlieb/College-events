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

/**
 * 25Live / CollegeNET Series25.
 *
 * Series25 itself is an authenticated scheduling system; what universities
 * publish is a **25Live Publisher** calendar, which exposes the same feed
 * as JSON, RSS and iCal at a stable URL. This adapter reads the published
 * feed and nothing else — the scheduling system behind it is not touched.
 *
 * Because which format a given campus publishes varies, the adapter walks
 * the documented fallback order rather than assuming one: JSON feed → iCal
 * → RSS. A campus that publishes only iCal is still fully crawlable.
 *
 * Config:
 * ```jsonc
 * {
 *   "publisherHost": "25livepub.collegenet.com",
 *   "calendarId": "1234",        // the Publisher calendar id or name
 *   "feedUrl": "https://…",      // explicit override, any supported format
 *   "lookaheadDays": 45
 * }
 * ```
 */

interface PublisherEvent {
  id?: number | string;
  eventId?: number | string;
  title?: string | null;
  subject?: string | null;
  description?: string | null;
  descriptionText?: string | null;
  location?: string | null;
  locationName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  start?: string | null;
  end?: string | null;
  url?: string | null;
  eventUrl?: string | null;
  customFields?: Record<string, unknown> | null;
}

function stringConfig(source: SourceInstance, key: string): string | null {
  const value = source.config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Candidate feed URLs in documented preference order. */
export function publisherFeedUrls(source: SourceInstance): string[] {
  const explicit = stringConfig(source, "feedUrl");
  if (explicit) return [explicit];

  const host = stringConfig(source, "publisherHost") ?? "25livepub.collegenet.com";
  const calendar = stringConfig(source, "calendarId");
  if (!calendar) {
    const url = source.discoveryUrl ?? source.url;
    return url ? [url] : [];
  }
  return [
    `https://${host}/calendars/${calendar}.json`,
    `https://${host}/calendars/${calendar}.ics`,
    `https://${host}/calendars/${calendar}.rss`,
  ];
}

function firstString(...values: (string | null | undefined)[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function publisherToDiscovered(feedUrl: string, event: PublisherEvent): DiscoveredEvent | null {
  const title = firstString(event.title, event.subject);
  const id = event.id ?? event.eventId;
  if (!title || id == null) return null;

  const start = firstString(event.startDate, event.start);
  const end = firstString(event.endDate, event.end);
  const location = firstString(event.location, event.locationName);
  const description = firstString(event.descriptionText, event.description);

  let host = "25live";
  try {
    host = new URL(feedUrl).host;
  } catch {
    // keep the fallback namespace rather than failing the whole batch
  }

  return {
    externalId: `25live-${host}-${id}`,
    sourceUrl: firstString(event.eventUrl, event.url),
    rawText: [
      title,
      start ? `Start: ${start}` : null,
      end ? `End: ${end}` : null,
      location ? `Location: ${location}` : null,
      description,
    ]
      .filter(Boolean)
      .join("\n"),
    mediaUrl: null, // Publisher feeds carry no imagery
    publishedAt: null,
    rawMetadata: {
      platform: "25live",
      publisherId: id,
      startsOn: start,
      endsOn: end,
      location,
      customFields: event.customFields ?? null,
    },
  };
}

/** Publisher JSON is sometimes a bare array, sometimes wrapped. */
function eventsFromJson(body: unknown): PublisherEvent[] {
  if (Array.isArray(body)) return body as PublisherEvent[];
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["events", "data", "results"]) {
      if (Array.isArray(record[key])) return record[key] as PublisherEvent[];
    }
  }
  return [];
}

async function fetchFeed(
  url: string,
  fetchImpl: typeof fetch,
  sourceId: string,
  signal?: AbortSignal,
): Promise<{ contentType: string; text: string }> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json, text/calendar, */*" }, signal });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new SourceAccessDeniedError(
      `25Live Publisher declined automated access (HTTP ${res.status})`,
      sourceId,
      `http_${res.status}`,
    );
  }
  if (!res.ok) throw new IngestionError(`25Live feed failed: HTTP ${res.status} (${url})`, sourceId);
  return { contentType: res.headers.get("content-type") ?? "", text: await res.text() };
}

export const collegeNetAdapter: EventSourceAdapter = {
  type: "25live",
  capabilities: { discovery: true, details: false, assets: false, incremental: false },

  async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
    const urls = publisherFeedUrls(source);
    if (urls.length === 0) {
      throw new IngestionError(
        "25Live source needs `calendarId` or `feedUrl` in config, or a URL to read",
        source.id,
      );
    }
    const fetchImpl = context.fetchImpl ?? fetch;
    const errors: string[] = [];

    for (const url of urls) {
      try {
        const { contentType, text } = await fetchFeed(url, fetchImpl, source.id, context.signal);

        // iCal is recognised by content, not extension — Publisher serves
        // .ics from URLs that do not always say so.
        if (/text\/calendar/i.test(contentType) || /^\s*BEGIN:VCALENDAR/im.test(text)) {
          const items = fetchIcsToItems(text);
          if (items.length > 0) return context.maxItems ? items.slice(0, context.maxItems) : items;
          continue;
        }

        if (/json/i.test(contentType) || text.trimStart().startsWith("[") || text.trimStart().startsWith("{")) {
          const events = eventsFromJson(JSON.parse(text));
          const items = events
            .map((e) => publisherToDiscovered(url, e))
            .filter((e): e is DiscoveredEvent => e !== null);
          if (items.length > 0) return context.maxItems ? items.slice(0, context.maxItems) : items;
          continue;
        }
      } catch (err) {
        // A challenge is worth surfacing immediately; a missing format is
        // just the next thing in the fallback chain.
        if (err instanceof SourceAccessDeniedError) throw err;
        errors.push(`${url}: ${(err as Error).message}`);
      }
    }

    if (errors.length === urls.length) {
      throw new IngestionError(`No 25Live feed could be read — ${errors.join("; ")}`, source.id);
    }
    return [];
  },

  async discoverAssets(): Promise<AssetCandidate[]> {
    // Publisher feeds genuinely carry no imagery. Returning nothing lets
    // another source's flyer win rather than inventing a weak candidate.
    return [];
  },

  async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
    const checkedAt = context.now ?? new Date();
    const [url] = publisherFeedUrls(source);
    if (!url) return { status: "failed", reason: "no calendar configured", checkedAt };
    try {
      await fetchFeed(url, context.fetchImpl ?? fetch, source.id, context.signal);
      return { status: "healthy", checkedAt };
    } catch (err) {
      if (err instanceof SourceAccessDeniedError) {
        return { status: "degraded", reason: err.message, checkedAt };
      }
      return { status: "failed", reason: (err as Error).message, checkedAt };
    }
  },
};

/**
 * Parses ICS text already in hand — the feed fetch has happened, so this
 * reuses the tested parser without a second network round trip.
 */
function fetchIcsToItems(ics: string): DiscoveredEvent[] {
  return parseIcs(ics).map(icsToDiscoveredItem);
}
