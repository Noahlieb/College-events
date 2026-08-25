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

/**
 * Eventbrite and Ticketmaster — platforms with real, official, documented
 * APIs that require a credential.
 *
 * Both retired their unauthenticated public search some years ago. The
 * supported route is an API key, so these adapters ask for one and report
 * AUTH_REQUIRED when the deployment has not supplied it. That is a
 * materially different state from "we cannot read this platform": the
 * adapter works, the operator just needs to add a key.
 *
 * Notably, neither adapter falls back to scraping the public site when the
 * key is missing. The absence of a key is not permission to take another
 * route.
 */

const EVENTBRITE_API = "https://www.eventbriteapi.com/v3";
const TICKETMASTER_API = "https://app.ticketmaster.com/discovery/v2";

export class MissingCredentialError extends Error {
  constructor(
    public readonly sourceId: string,
    public readonly envVar: string,
    platform: string,
  ) {
    super(`${platform} needs ${envVar} to be configured before it can be crawled`);
    this.name = "MissingCredentialError";
  }
}

function stringConfig(source: SourceInstance, key: string): string | null {
  const value = source.config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function credential(
  source: SourceInstance,
  configKey: string,
  envVar: string,
  env: Record<string, string | undefined>,
): string | null {
  // Config first so one deployment can hold several organizers' tokens;
  // env is the ordinary single-tenant case.
  return stringConfig(source, configKey) ?? env[envVar] ?? null;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  sourceId: string,
  platform: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, init);
  if (res.status === 401 || res.status === 403) {
    throw new SourceAccessDeniedError(
      `${platform} rejected the configured credential (HTTP ${res.status})`,
      sourceId,
      `http_${res.status}`,
    );
  }
  if (res.status === 429) {
    throw new SourceAccessDeniedError(`${platform} rate limit reached`, sourceId, "http_429");
  }
  if (!res.ok) throw new IngestionError(`${platform} API failed: HTTP ${res.status}`, sourceId);
  return (await res.json()) as T;
}

// ── Eventbrite ─────────────────────────────────────────────────────

interface EventbriteEvent {
  id?: string;
  name?: { text?: string | null };
  description?: { text?: string | null };
  url?: string | null;
  start?: { utc?: string | null; local?: string | null };
  end?: { utc?: string | null; local?: string | null };
  logo?: { url?: string | null; original?: { url?: string | null } } | null;
  venue?: { name?: string | null; address?: { localized_address_display?: string | null } } | null;
  is_free?: boolean;
  organizer_id?: string | null;
}

interface EventbritePage {
  events?: EventbriteEvent[];
  pagination?: { has_more_items?: boolean; continuation?: string | null };
}

export function eventbriteToDiscovered(event: EventbriteEvent): DiscoveredEvent | null {
  const name = event.name?.text?.trim();
  if (!event.id || !name) return null;

  // `original` is the full-resolution upload; `url` is a resized crop. The
  // flyer pipeline prefers larger copies of the same artwork, so offer the
  // original when it exists.
  const logo = event.logo?.original?.url ?? event.logo?.url ?? null;
  const venue = event.venue?.name ?? null;
  const address = event.venue?.address?.localized_address_display ?? null;

  return {
    externalId: `eventbrite-${event.id}`,
    sourceUrl: event.url ?? null,
    rawText: [
      name,
      event.start?.local ? `Start: ${event.start.local}` : null,
      event.end?.local ? `End: ${event.end.local}` : null,
      venue ? `Location: ${[venue, address].filter(Boolean).join(", ")}` : null,
      event.is_free ? "Cost: Free" : null,
      event.description?.text?.trim() || null,
    ]
      .filter(Boolean)
      .join("\n"),
    mediaUrl: logo,
    publishedAt: null,
    rawMetadata: {
      platform: "eventbrite",
      eventbriteId: event.id,
      startsOn: event.start?.utc ?? null,
      endsOn: event.end?.utc ?? null,
      venue,
      address,
      isFree: event.is_free ?? null,
      organizerId: event.organizer_id ?? null,
      logoUrl: logo,
    },
  };
}

export const eventbriteAdapter: EventSourceAdapter = {
  type: "eventbrite",
  capabilities: { discovery: true, details: false, assets: true, incremental: false },

  async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
    const env = context.env ?? process.env;
    const token = credential(source, "apiToken", "EVENTBRITE_API_TOKEN", env);
    if (!token) throw new MissingCredentialError(source.id, "EVENTBRITE_API_TOKEN", "Eventbrite");

    // Eventbrite's public search was retired; events are read per
    // organization or organizer, which is what a source row identifies.
    const organizationId = stringConfig(source, "organizationId");
    const organizerId = stringConfig(source, "organizerId");
    if (!organizationId && !organizerId) {
      throw new IngestionError(
        "Eventbrite source needs `organizationId` or `organizerId` in config — the public search API no longer exists",
        source.id,
      );
    }

    const fetchImpl = context.fetchImpl ?? fetch;
    const base = organizationId
      ? `${EVENTBRITE_API}/organizations/${organizationId}/events/`
      : `${EVENTBRITE_API}/organizers/${organizerId}/events/`;

    const items: DiscoveredEvent[] = [];
    let continuation: string | null = null;

    while (true) {
      const url = new URL(base);
      url.searchParams.set("status", "live");
      url.searchParams.set("order_by", "start_asc");
      url.searchParams.set("expand", "venue,logo");
      if (continuation) url.searchParams.set("continuation", continuation);

      const page: EventbritePage = await fetchJson<EventbritePage>(
        url.toString(),
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: context.signal },
        source.id,
        "Eventbrite",
        fetchImpl,
      );

      for (const event of page.events ?? []) {
        const item = eventbriteToDiscovered(event);
        if (item) items.push(item);
        if (context.maxItems && items.length >= context.maxItems) return items;
      }

      if (!page.pagination?.has_more_items || !page.pagination.continuation) break;
      continuation = page.pagination.continuation;
    }

    return items;
  },

  async discoverAssets(_source: SourceInstance, event: RawEventPayload): Promise<AssetCandidate[]> {
    const logo = event.rawMetadata?.logoUrl;
    if (typeof logo !== "string" || !logo) return [];
    return [{ sourceUrl: logo, origin: "api", isOfficial: true, confidence: 0.85 }];
  },

  async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
    const checkedAt = context.now ?? new Date();
    const env = context.env ?? process.env;
    if (!credential(source, "apiToken", "EVENTBRITE_API_TOKEN", env)) {
      // Not a failure of the source — a gap in this deployment's config.
      return { status: "disabled", reason: "EVENTBRITE_API_TOKEN is not configured", checkedAt };
    }
    return { status: "healthy", checkedAt };
  },
};

// ── Ticketmaster ───────────────────────────────────────────────────

interface TicketmasterImage {
  url?: string;
  width?: number;
  height?: number;
  ratio?: string;
}

interface TicketmasterEvent {
  id?: string;
  name?: string;
  url?: string;
  info?: string;
  pleaseNote?: string;
  images?: TicketmasterImage[];
  dates?: { start?: { dateTime?: string; localDate?: string; localTime?: string } };
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  _embedded?: {
    venues?: { name?: string; city?: { name?: string }; address?: { line1?: string } }[];
  };
}

interface TicketmasterPage {
  _embedded?: { events?: TicketmasterEvent[] };
  page?: { totalPages?: number; number?: number };
}

/** Largest image Ticketmaster offers — they publish several crops. */
export function largestImage(images: TicketmasterImage[] | undefined): TicketmasterImage | null {
  if (!images || images.length === 0) return null;
  return images.reduce((best, image) =>
    (image.width ?? 0) * (image.height ?? 0) > (best.width ?? 0) * (best.height ?? 0) ? image : best,
  );
}

export function ticketmasterToDiscovered(event: TicketmasterEvent): DiscoveredEvent | null {
  if (!event.id || !event.name) return null;
  const venue = event._embedded?.venues?.[0];
  const image = largestImage(event.images);
  const price = event.priceRanges?.[0];

  return {
    externalId: `ticketmaster-${event.id}`,
    sourceUrl: event.url ?? null,
    rawText: [
      event.name,
      event.dates?.start?.dateTime ? `Start: ${event.dates.start.dateTime}` : null,
      venue?.name ? `Location: ${[venue.name, venue.address?.line1, venue.city?.name].filter(Boolean).join(", ")}` : null,
      price?.min != null ? `Cost: ${price.min}${price.max != null && price.max !== price.min ? `-${price.max}` : ""} ${price.currency ?? ""}`.trim() : null,
      event.info ?? event.pleaseNote ?? null,
    ]
      .filter(Boolean)
      .join("\n"),
    mediaUrl: image?.url ?? null,
    publishedAt: null,
    rawMetadata: {
      platform: "ticketmaster",
      ticketmasterId: event.id,
      startsOn: event.dates?.start?.dateTime ?? null,
      venue: venue?.name ?? null,
      city: venue?.city?.name ?? null,
      address: venue?.address?.line1 ?? null,
      imageUrl: image?.url ?? null,
      imageWidth: image?.width ?? null,
      imageHeight: image?.height ?? null,
    },
  };
}

export const ticketmasterAdapter: EventSourceAdapter = {
  type: "ticketmaster",
  capabilities: { discovery: true, details: false, assets: true, incremental: false },

  async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
    const env = context.env ?? process.env;
    const apiKey = credential(source, "apiKey", "TICKETMASTER_API_KEY", env);
    if (!apiKey) throw new MissingCredentialError(source.id, "TICKETMASTER_API_KEY", "Ticketmaster");

    const fetchImpl = context.fetchImpl ?? fetch;
    const now = context.now ?? new Date();
    const days = context.lookaheadDays ?? 45;
    const size = 100;

    const items: DiscoveredEvent[] = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const url = new URL(`${TICKETMASTER_API}/events.json`);
      url.searchParams.set("apikey", apiKey);
      url.searchParams.set("size", String(size));
      url.searchParams.set("page", String(page));
      url.searchParams.set("sort", "date,asc");
      url.searchParams.set("startDateTime", now.toISOString().replace(/\.\d+Z$/, "Z"));
      url.searchParams.set(
        "endDateTime",
        new Date(now.getTime() + days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z"),
      );

      // Geography comes from the source, which is how one adapter serves
      // every university's local market.
      const city = stringConfig(source, "city");
      const stateCode = stringConfig(source, "stateCode");
      const latlong = stringConfig(source, "latlong");
      const radius = stringConfig(source, "radiusMiles");
      if (city) url.searchParams.set("city", city);
      if (stateCode) url.searchParams.set("stateCode", stateCode);
      if (latlong) {
        url.searchParams.set("latlong", latlong);
        url.searchParams.set("unit", "miles");
        if (radius) url.searchParams.set("radius", radius);
      }
      if (!city && !latlong) {
        throw new IngestionError(
          "Ticketmaster source needs `city` or `latlong` in config to scope its market",
          source.id,
        );
      }

      const body = await fetchJson<TicketmasterPage>(
        url.toString(),
        { headers: { Accept: "application/json" }, signal: context.signal },
        source.id,
        "Ticketmaster",
        fetchImpl,
      );

      const batch = body._embedded?.events ?? [];
      if (batch.length === 0) break;
      for (const event of batch) {
        const item = ticketmasterToDiscovered(event);
        if (item) items.push(item);
        if (context.maxItems && items.length >= context.maxItems) return items;
      }

      totalPages = body.page?.totalPages ?? 1;
      page++;
      // The Discovery API caps deep paging at 1000 results; asking past it
      // returns an error rather than an empty page.
      if (page * size >= 1000) break;
    }

    return items;
  },

  async discoverAssets(_source: SourceInstance, event: RawEventPayload): Promise<AssetCandidate[]> {
    const url = event.rawMetadata?.imageUrl;
    if (typeof url !== "string" || !url) return [];
    return [
      {
        sourceUrl: url,
        origin: "api",
        isOfficial: true,
        confidence: 0.8,
        width: (event.rawMetadata?.imageWidth as number | null) ?? null,
        height: (event.rawMetadata?.imageHeight as number | null) ?? null,
      },
    ];
  },

  async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
    const checkedAt = context.now ?? new Date();
    const env = context.env ?? process.env;
    if (!credential(source, "apiKey", "TICKETMASTER_API_KEY", env)) {
      return { status: "disabled", reason: "TICKETMASTER_API_KEY is not configured", checkedAt };
    }
    return { status: "healthy", checkedAt };
  },
};
