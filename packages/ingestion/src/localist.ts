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
 * Localist (Concept3D) — the platform behind a large share of university
 * master calendars.
 *
 * Localist ships a documented public read API at `/api/2/events`, which is
 * why this adapter is worth having over the generic JSON-LD path: it
 * paginates properly, takes a date window, and returns the event's own
 * photo rather than whatever the page put in its link preview.
 *
 * The only school-specific fact is the host. `config.host` or a configured
 * URL supplies it; nothing here knows about any particular university.
 *
 * Config:
 * ```jsonc
 * {
 *   "host": "events.ucf.edu",   // required unless a URL is set
 *   "lookaheadDays": 45,
 *   "pageSize": 100,
 *   "groupId": 1234,            // optional: one department's calendar
 *   "placeId": 567              // optional: one venue's calendar
 * }
 * ```
 */

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_LOOKAHEAD_DAYS = 45;
/** Localist rejects `pp` above 100. */
const MAX_PAGE_SIZE = 100;

interface LocalistInstance {
  event_instance?: { id?: number; start?: string | null; end?: string | null };
}

interface LocalistEvent {
  id?: number;
  title?: string | null;
  description_text?: string | null;
  localist_url?: string | null;
  url?: string | null;
  photo_url?: string | null;
  location_name?: string | null;
  address?: string | null;
  room_number?: string | null;
  geo?: { latitude?: string | null; longitude?: string | null } | null;
  event_instances?: LocalistInstance[];
  filters?: Record<string, { name?: string }[]> | null;
  keywords?: string[] | null;
  tags?: string[] | null;
  ticket_url?: string | null;
  ticket_cost?: string | null;
  department_name?: string | null;
}

interface LocalistResponse {
  events?: { event?: LocalistEvent }[];
  page?: { current?: number; size?: number; total?: number };
}

export function resolveLocalistHost(source: SourceInstance): string | null {
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

export function localistApiUrl(
  host: string,
  params: { page: number; pageSize: number; days: number; groupId?: number; placeId?: number },
): string {
  const query = new URLSearchParams({
    // `days` is Localist's own forward window; it is the supported way to
    // ask for upcoming events rather than paging through history.
    days: String(params.days),
    pp: String(Math.min(params.pageSize, MAX_PAGE_SIZE)),
    page: String(params.page),
    distinct: "true",
  });
  if (params.groupId != null) query.set("group_id", String(params.groupId));
  if (params.placeId != null) query.set("place_id", String(params.placeId));
  return `https://${host}/api/2/events?${query.toString()}`;
}

function firstInstance(event: LocalistEvent): { start?: string | null; end?: string | null } | null {
  const instance = event.event_instances?.[0]?.event_instance;
  return instance ?? null;
}

function filterNames(event: LocalistEvent): string[] {
  const out: string[] = [];
  for (const values of Object.values(event.filters ?? {})) {
    for (const value of values ?? []) if (value?.name) out.push(value.name);
  }
  return out;
}

export function localistToDiscovered(host: string, event: LocalistEvent): DiscoveredEvent | null {
  if (event.id == null) return null;
  const title = (event.title ?? "").trim();
  if (!title) return null;

  const instance = firstInstance(event);
  const location = [event.location_name, event.room_number, event.address].filter(Boolean).join(", ");

  const textParts = [
    title,
    event.department_name ? `Hosted by: ${event.department_name}` : null,
    instance?.start ? `Start: ${instance.start}` : null,
    instance?.end ? `End: ${instance.end}` : null,
    location ? `Location: ${location}` : null,
    event.ticket_cost ? `Cost: ${event.ticket_cost}` : null,
    (event.description_text ?? "").trim() || null,
  ].filter(Boolean);

  const latitude = event.geo?.latitude ? Number(event.geo.latitude) : null;
  const longitude = event.geo?.longitude ? Number(event.geo.longitude) : null;

  return {
    // Namespaced by host: Localist ids are per-install, so a bare id would
    // merge two universities' event #1234.
    externalId: `localist-${host}-${event.id}`,
    sourceUrl: event.localist_url ?? event.url ?? `https://${host}/event/${event.id}`,
    rawText: textParts.join("\n"),
    mediaUrl: event.photo_url ?? null,
    publishedAt: null,
    rawMetadata: {
      platform: "localist",
      localistId: event.id,
      startsOn: instance?.start ?? null,
      endsOn: instance?.end ?? null,
      location: location || null,
      venue: event.location_name ?? null,
      address: event.address ?? null,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      department: event.department_name ?? null,
      ticketUrl: event.ticket_url ?? null,
      ticketCost: event.ticket_cost ?? null,
      filters: filterNames(event),
      keywords: event.keywords ?? event.tags ?? [],
      photoUrl: event.photo_url ?? null,
    },
  };
}

function numberConfig(source: SourceInstance, key: string, fallback: number): number {
  const value = source.config[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function optionalNumber(source: SourceInstance, key: string): number | undefined {
  const value = source.config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function fetchPage(
  url: string,
  fetchImpl: typeof fetch,
  sourceId: string,
  signal?: AbortSignal,
): Promise<LocalistResponse> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new SourceAccessDeniedError(
      `Localist declined automated access (HTTP ${res.status})`,
      sourceId,
      `http_${res.status}`,
    );
  }
  if (!res.ok) throw new IngestionError(`Localist API failed: HTTP ${res.status} (${url})`, sourceId);
  return (await res.json()) as LocalistResponse;
}

export const localistAdapter: EventSourceAdapter = {
  type: "localist",
  capabilities: { discovery: true, details: false, assets: true, incremental: false },

  async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
    const host = resolveLocalistHost(source);
    if (!host) {
      throw new IngestionError("Localist source needs a `host` in config or a URL to derive it from", source.id);
    }
    const fetchImpl = context.fetchImpl ?? fetch;
    const days = context.lookaheadDays ?? numberConfig(source, "lookaheadDays", DEFAULT_LOOKAHEAD_DAYS);
    const pageSize = numberConfig(source, "pageSize", DEFAULT_PAGE_SIZE);
    const groupId = optionalNumber(source, "groupId");
    const placeId = optionalNumber(source, "placeId");

    const items: DiscoveredEvent[] = [];
    let page = 1;
    let totalPages: number | null = null;

    while (true) {
      const url = localistApiUrl(host, { page, pageSize, days, groupId, placeId });
      const body = await fetchPage(url, fetchImpl, source.id, context.signal);

      const batch = body.events ?? [];
      if (batch.length === 0) break;

      for (const wrapper of batch) {
        const event = wrapper.event;
        if (!event) continue;
        const item = localistToDiscovered(host, event);
        if (item) items.push(item);
        if (context.maxItems && items.length >= context.maxItems) return items;
      }

      // Localist reports total *pages*, not total events — reading it as a
      // count is the easy way to stop after one page.
      totalPages ??= body.page?.total ?? 1;
      if (page >= totalPages) break;
      page++;
    }

    return items;
  },

  /**
   * Localist's `photo_url` is the image a calendar administrator attached
   * to the event, which makes it official event art. A ticketing link is
   * offered as a lead for the flyer pipeline rather than as an image.
   */
  async discoverAssets(_source: SourceInstance, event: RawEventPayload): Promise<AssetCandidate[]> {
    const photo = event.rawMetadata?.photoUrl;
    if (typeof photo !== "string" || !photo) return [];
    return [{ sourceUrl: photo, origin: "api", isOfficial: true, confidence: 0.85 }];
  },

  async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
    const checkedAt = context.now ?? new Date();
    const host = resolveLocalistHost(source);
    if (!host) return { status: "failed", reason: "no host configured", checkedAt };

    try {
      await fetchPage(
        localistApiUrl(host, { page: 1, pageSize: 1, days: 1 }),
        context.fetchImpl ?? fetch,
        source.id,
        context.signal,
      );
      return { status: "healthy", checkedAt };
    } catch (err) {
      if (err instanceof SourceAccessDeniedError) {
        return { status: "degraded", reason: err.message, checkedAt };
      }
      return { status: "failed", reason: (err as Error).message, checkedAt };
    }
  },
};
