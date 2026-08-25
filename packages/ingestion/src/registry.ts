import type { AdapterType, SourceType } from "@college-events/core";
import type {
  AdapterCapabilities,
  CrawlContext,
  DiscoveredEvent,
  EventSourceAdapter,
  SourceInstance,
} from "./adapter.js";
import type { SourceAdapter } from "./types.js";
import { owlCentralAdapter, icalAdapter } from "./ical.js";
import { rssAdapter } from "./rss.js";
import { genericWebpageAdapter } from "./jsonld.js";
import { sidearmAthleticsAdapter } from "./sidearm.js";
import { campusLabsAdapter } from "./campuslabs.js";
import { poshAdapter } from "./posh.js";

/**
 * Wraps a pre-existing `SourceAdapter` (the `fetchNew(ctx)` shape) as an
 * `EventSourceAdapter`. These adapters were already university-agnostic —
 * they read everything from the source row — so they need a new signature,
 * not a rewrite. Keeping the bridge means the working iCal/RSS/JSON-LD/
 * SIDEARM code paths are byte-for-byte the ones that were passing tests
 * before the refactor.
 */
export function fromLegacyAdapter(
  type: AdapterType,
  capabilities: AdapterCapabilities,
  legacy: SourceAdapter,
): EventSourceAdapter {
  return {
    type,
    capabilities,
    async discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]> {
      return legacy.fetchNew({
        source: {
          id: source.id,
          // Legacy adapters only know `url`; a source that keeps its crawl
          // entry point in discoveryUrl still resolves correctly here.
          url: source.discoveryUrl ?? source.url,
          instagramHandle: source.instagramHandle,
          metadata: source.metadata,
        },
        lastSuccessfulCheckAt: source.lastSuccessfulCheckAt,
        maxItems: context.maxItems,
        fetchImpl: context.fetchImpl,
      });
    },
  };
}

const FEED_CAPABILITIES: AdapterCapabilities = {
  discovery: true,
  details: false,
  assets: false,
  incremental: false,
};

/**
 * ADAPTER REGISTRY — keyed on adapter type, which is the reusable axis.
 *
 * Adding a university adds rows to `sources`; it does not add entries
 * here. Entries are only added when a genuinely new *platform* appears.
 */
const ADAPTERS: EventSourceAdapter[] = [
  // Native implementations of the new interface.
  campusLabsAdapter,
  poshAdapter,
  // Pre-refactor adapters, bridged rather than rewritten.
  fromLegacyAdapter("sidearm", { ...FEED_CAPABILITIES, assets: true }, sidearmAthleticsAdapter),
  fromLegacyAdapter("ical", FEED_CAPABILITIES, icalAdapter),
  fromLegacyAdapter("rss", FEED_CAPABILITIES, rssAdapter),
  fromLegacyAdapter("jsonld", { ...FEED_CAPABILITIES, assets: true }, genericWebpageAdapter),
  fromLegacyAdapter("generic_web", { ...FEED_CAPABILITIES, assets: true }, genericWebpageAdapter),
];

const BY_TYPE = new Map<AdapterType, EventSourceAdapter>(ADAPTERS.map((a) => [a.type, a]));

/** Registers an adapter, replacing any existing one of the same type. */
export function registerAdapter(adapter: EventSourceAdapter): void {
  BY_TYPE.set(adapter.type, adapter);
}

/** The adapter for a platform, or null if we can't crawl that platform yet. */
export function adapterFor(adapterType: AdapterType): EventSourceAdapter | null {
  return BY_TYPE.get(adapterType) ?? null;
}

/** Every registered adapter type — used by the dashboard's source form. */
export function registeredAdapterTypes(): AdapterType[] {
  return [...BY_TYPE.keys()];
}

/**
 * Legacy lookup by `source_type`, retained so any caller not yet migrated
 * to `adapter_type` keeps working. New code should call `adapterFor()`.
 *
 * Instagram is intentionally absent: social is push-fed through the
 * authorized external-social endpoint, never polled or scraped here.
 * `manual_submission` and `other_api` likewise have no generic adapter.
 */
const LEGACY_ADAPTERS: SourceAdapter[] = [
  owlCentralAdapter,
  icalAdapter,
  rssAdapter,
  sidearmAthleticsAdapter,
  genericWebpageAdapter,
];

export function adapterForSourceType(sourceType: SourceType): SourceAdapter | null {
  return LEGACY_ADAPTERS.find((a) => a.supportedTypes.includes(sourceType)) ?? null;
}
