import type { SourceType } from "@college-events/core";
import type { SourceAdapter } from "./types.js";
import { owlCentralAdapter, icalAdapter } from "./ical.js";
import { rssAdapter } from "./rss.js";
import { genericWebpageAdapter } from "./jsonld.js";

const ADAPTERS: SourceAdapter[] = [owlCentralAdapter, icalAdapter, rssAdapter, genericWebpageAdapter];

/**
 * Looks up the polling adapter for a source type. Instagram sources are
 * intentionally excluded — they're fed by the PhantomBuster importer (a
 * push, not a poll) or a future Meta API connector, never polled directly
 * here. `manual_submission` and `other_api` likewise have no generic
 * adapter: manual entries go through buildManualRawContent(), and
 * other_api is a placeholder for school-specific integrations added later.
 */
export function adapterForSourceType(sourceType: SourceType): SourceAdapter | null {
  return ADAPTERS.find((a) => a.supportedTypes.includes(sourceType)) ?? null;
}
