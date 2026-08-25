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
import {
  assetsFromPage,
  eventFromStructuredPage,
  extractLinks,
  fetchStructuredPage,
} from "./structured-page.js";

/**
 * CampusGroups — student engagement platform, comparable in role to
 * CampusLabs Engage.
 *
 * Unlike Localist, CampusGroups has no documented public read API; its
 * data API is for authenticated institutional use. What each install does
 * publish is a public events page and, on most deployments, an iCal feed —
 * both intended to be read by outside software.
 *
 * So this adapter walks the documented public surface in preference order:
 * the iCal feed if the campus publishes one, otherwise the public listing
 * page and the schema.org JSON-LD on each event page. No private endpoint
 * is called and no authentication is simulated. A campus that publishes
 * neither yields nothing and reports why.
 *
 * Config:
 * ```jsonc
 * {
 *   "host": "ucf.campusgroups.com",
 *   "icsUrl": "https://…/ical/…",   // preferred when the campus has one
 *   "listingPath": "/events"
 * }
 * ```
 */

function stringConfig(source: SourceInstance, key: string): string | null {
  const value = source.config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveCampusGroupsHost(source: SourceInstance): string | null {
  const configured = stringConfig(source, "host");
  if (configured) return configured;
  const candidate = source.discoveryUrl ?? source.url;
  if (!candidate) return null;
  try {
    return new URL(candidate).host;
  } catch {
    return null;
  }
}

/** Stable id for an event page, so the same event is one row. */
export function campusGroupsExternalId(host: string, url: string): string {
  const match = /\/(?:event|rsvp)\/(\d+)/i.exec(url);
  if (match) return `campusgroups-${host}-${match[1]}`;
  try {
    return `campusgroups-${host}-${new URL(url).pathname.replace(/^\/+|\/+$/g, "")}`;
  } catch {
    return `campusgroups-${host}-${url}`;
  }
}

export const campusGroupsAdapter: EventSourceAdapter = {
  type: "campusgroups",
  capabilities: { discovery: true, details: true, assets: true, incremental: false },

  async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
    const host = resolveCampusGroupsHost(source);
    if (!host) {
      throw new IngestionError("CampusGroups source needs a `host` in config or a URL", source.id);
    }
    const fetchImpl = context.fetchImpl ?? fetch;

    // Preferred: the campus's own iCal feed. Structured, complete, and
    // explicitly published for outside readers.
    const icsUrl = stringConfig(source, "icsUrl");
    if (icsUrl) {
      const res = await fetchImpl(icsUrl, { headers: { Accept: "text/calendar" }, signal: context.signal });
      if (res.ok) {
        const items = parseIcs(await res.text()).map(icsToDiscoveredItem);
        if (items.length > 0) return context.maxItems ? items.slice(0, context.maxItems) : items;
      }
      // Fall through: a stale ics URL should not mean zero events when the
      // public listing is right there.
    }

    const listingPath = stringConfig(source, "listingPath") ?? "/events";
    const listingUrl = source.discoveryUrl ?? `https://${host}${listingPath}`;
    const listingHtml = await fetchStructuredPage(listingUrl, source.id, fetchImpl, context.signal);

    const eventUrls = extractLinks(listingHtml, listingUrl, /\/(event|rsvp)\//i);
    const items: DiscoveredEvent[] = [];

    for (const url of eventUrls) {
      if (context.maxItems && items.length >= context.maxItems) break;
      try {
        const html = await fetchStructuredPage(url, source.id, fetchImpl, context.signal);
        const item = eventFromStructuredPage(url, html, {
          platform: "campusgroups",
          externalId: campusGroupsExternalId(host, url),
        });
        if (item) items.push(item);
      } catch (err) {
        // One event page being challenged should not abandon the rest, but
        // a challenge means the platform is refusing us — stop asking.
        if (err instanceof SourceAccessDeniedError) {
          if (items.length === 0) throw err;
          break;
        }
        throw err;
      }
    }

    return items;
  },

  async discoverAssets(
    source: SourceInstance,
    event: RawEventPayload,
    context: CrawlContext,
  ): Promise<AssetCandidate[]> {
    if (!event.sourceUrl) return [];
    try {
      const html = await fetchStructuredPage(
        event.sourceUrl,
        source.id,
        context.fetchImpl ?? fetch,
        context.signal,
      );
      // The engagement platform hosts the event, so its artwork is
      // official for that event.
      return assetsFromPage(html, { isOfficial: true });
    } catch {
      // Asset discovery is best-effort by design: failing to find a better
      // image must never fail the event.
      return [];
    }
  },

  async healthCheck(source: SourceInstance, context: CrawlContext): Promise<SourceHealth> {
    const checkedAt = context.now ?? new Date();
    const host = resolveCampusGroupsHost(source);
    if (!host) return { status: "failed", reason: "no host configured", checkedAt };
    const target = stringConfig(source, "icsUrl") ?? source.discoveryUrl ?? `https://${host}/events`;
    try {
      await fetchStructuredPage(target, source.id, context.fetchImpl ?? fetch, context.signal);
      return { status: "healthy", checkedAt };
    } catch (err) {
      if (err instanceof SourceAccessDeniedError) {
        return { status: "degraded", reason: err.message, checkedAt };
      }
      return { status: "failed", reason: (err as Error).message, checkedAt };
    }
  },
};
