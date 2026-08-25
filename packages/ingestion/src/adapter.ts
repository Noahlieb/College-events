import type { AdapterType, EventCategory, SourceHealthStatus } from "@college-events/core";
import type { DiscoveredItem } from "./types.js";

/**
 * ADAPTER ≠ SOURCE.
 *
 * An **adapter** is a reusable way of talking to a *platform*. There is one
 * `campuslabs` adapter, and it serves FAU's Owl Central, UCF's Knight
 * Connect and every other Anthology Engage campus without modification.
 *
 * A **source instance** is one university's use of an adapter: the name a
 * human recognises, the host to hit, the org id to filter on. Everything
 * school-specific lives here, in `config` — never in adapter code. That is
 * the whole reason adding the 100th university is a data operation rather
 * than a 100th scraper.
 */
export interface SourceInstance {
  id: string;
  schoolId: string;
  name: string;
  adapterType: AdapterType;
  /** Public-facing URL of the thing (a venue's site, an athletics home page). */
  url: string | null;
  /** Where a crawl actually starts, when that differs from `url`: an API
   * root, a feed path, a paginated listing. */
  discoveryUrl: string | null;
  instagramHandle: string | null;
  /** Adapter-specific settings. Each adapter documents its own shape. */
  config: Record<string, unknown>;
  /** Legacy free-form blob, still read for `forceCategory` on old rows. */
  metadata: Record<string, unknown>;
  categoryBias: EventCategory | null;
  lastSuccessfulCheckAt: Date | null;
  lastEventFoundAt: Date | null;
}

/** Per-run knobs. Nothing here is source-specific or persisted. */
export interface CrawlContext {
  /** Injectable for tests and for environments needing a proxying fetch. */
  fetchImpl?: typeof fetch;
  /** Cap items inspected per run. Adapters should honour it where cheap. */
  maxItems?: number;
  /** How far ahead to look, for adapters whose API takes a date range. */
  lookaheadDays?: number;
  /** Frozen "now" so a run is reproducible in tests. */
  now?: Date;
  /** Credential lookup, injectable so adapters needing an API key are
   * testable without touching the real environment. Defaults to
   * `process.env` at the point of use. */
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** Per-request fetch timeout in ms, enforced by the worker's crawl
   * pipeline (see `runSource` in apps/worker). Overridable for tests that
   * need a hung request to time out quickly rather than waiting out the
   * production default. */
  fetchTimeoutMs?: number;
}

/**
 * One event as a single source reported it — the input to a `raw_content`
 * row. Structurally identical to the original `DiscoveredItem`, aliased so
 * the pipeline can be read in the new vocabulary without a rename churn
 * across every existing adapter.
 */
export type DiscoveredEvent = DiscoveredItem;

/** A discovered event enriched by an optional detail fetch. */
export interface RawEventPayload extends DiscoveredEvent {
  /** Populated by `fetchDetails` when the listing was thin. */
  detail?: Record<string, unknown>;
}

/**
 * A possible flyer/artwork for an event, before anything decides which one
 * wins. Deliberately un-opinionated: the canonical-asset choice happens at
 * the *event* level (Stage 5), because a better image often arrives from a
 * different source reporting the same event.
 */
export interface AssetCandidate {
  sourceUrl: string;
  /** Where it was found: json-ld image, og:image, hero, poster, link. */
  origin: "jsonld" | "opengraph" | "hero" | "poster" | "linked" | "organizer" | "venue" | "api";
  width?: number | null;
  height?: number | null;
  mime?: string | null;
  /** True only when the source is authoritative for this event — an
   * official organizer/venue/platform page, not a third-party repost. */
  isOfficial: boolean;
  confidence: number; // 0..1
}

export interface SourceHealth {
  status: SourceHealthStatus;
  reason?: string;
  checkedAt: Date;
}

/**
 * What an adapter can actually do. The crawler reads this instead of
 * probing: an adapter without `details` is never asked for them, and one
 * without `incremental` gets a full window each run rather than a
 * since-cursor that would silently return nothing.
 */
export interface AdapterCapabilities {
  /** Can list events at all. False only for push-fed inputs. */
  discovery: boolean;
  /** Can fetch a richer per-event record than the listing carries. */
  details: boolean;
  /** Can offer flyer/artwork candidates. */
  assets: boolean;
  /** Supports "only what changed since X" rather than a full re-list. */
  incremental: boolean;
}

/**
 * The reusable platform integration. Implementations must be
 * university-agnostic: read `source.config`, never a school name.
 */
export interface EventSourceAdapter {
  readonly type: AdapterType;
  readonly capabilities: AdapterCapabilities;

  discover(source: SourceInstance, context: CrawlContext): Promise<DiscoveredEvent[]>;

  fetchDetails?(
    source: SourceInstance,
    event: DiscoveredEvent,
    context: CrawlContext,
  ): Promise<RawEventPayload>;

  discoverAssets?(
    source: SourceInstance,
    event: RawEventPayload,
    context: CrawlContext,
  ): Promise<AssetCandidate[]>;

  healthCheck?(source: SourceInstance, context: CrawlContext): Promise<SourceHealth>;
}

/**
 * Thrown when a source refuses automated access — an anti-bot challenge, a
 * login wall, a 403. This is deliberately a *distinct* failure from a bug:
 * the crawler records DEGRADED with the reason, stops retrying, and lets
 * other sources cover the same events. We do not attempt to defeat these
 * controls, so "try harder" is never the response.
 */
export class SourceAccessDeniedError extends Error {
  constructor(
    message: string,
    public readonly sourceId: string,
    /** e.g. "cloudflare_challenge", "http_403", "login_required" */
    public readonly kind: string,
  ) {
    super(message);
    this.name = "SourceAccessDeniedError";
  }
}
