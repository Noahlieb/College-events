import { and, eq } from "drizzle-orm";
import { assetCandidates, db, entitySources, events, sources } from "@college-events/db";
import {
  decideEventAsset,
  shouldUpgradeAsset,
  type AssetCandidateLike,
  type AssetClassification,
} from "@college-events/core";
import type { AssetCandidate } from "@college-events/ingestion";

/**
 * Flyer selection for a canonical event, across every source that reported
 * it.
 *
 * The single most important behaviour here is what it *doesn't* do: it
 * never asks "does this source have an image?". It asks "does this event
 * have artwork anywhere?". Those differ exactly when it matters — a
 * campus feed lists a party with no image while the promoter's own page,
 * already linked to the same event, has the flyer.
 */

type AssetRow = typeof assetCandidates.$inferSelect;

/**
 * Turns an adapter's offer into a stored candidate.
 *
 * Adapters report `isOfficial` because only they know whether the page
 * they read speaks for the event. Classification is inferred here so the
 * rule lives in one place: an image an adapter marked official and that
 * came from the event's own record is a flyer; an organizer avatar is a
 * logo however official it is.
 */
export function classifyCandidate(candidate: AssetCandidate): AssetClassification {
  if (candidate.origin === "organizer" && !candidate.isOfficial) return "logo";
  if (candidate.origin === "venue" && !candidate.isOfficial) return "logo";
  if (!candidate.isOfficial) return "photo";
  if (candidate.origin === "api" || candidate.origin === "jsonld" || candidate.origin === "poster") {
    return "flyer";
  }
  if (candidate.origin === "hero" || candidate.origin === "opengraph") return "event_art";
  return "unknown";
}

/** Records what one source offered for one event. Idempotent per URL. */
export async function recordAssetCandidates(args: {
  schoolId: string;
  eventId: string;
  sourceId: string | null;
  rawContentId: string | null;
  candidates: AssetCandidate[];
}): Promise<number> {
  let stored = 0;
  for (const candidate of args.candidates) {
    const inserted = await db
      .insert(assetCandidates)
      .values({
        schoolId: args.schoolId,
        eventId: args.eventId,
        sourceId: args.sourceId,
        rawContentId: args.rawContentId,
        sourceUrl: candidate.sourceUrl,
        width: candidate.width ?? null,
        height: candidate.height ?? null,
        mime: candidate.mime ?? null,
        classification: classifyCandidate(candidate),
        isOfficial: candidate.isOfficial,
        isAiGenerated: false,
        confidence: candidate.confidence,
        origin: candidate.origin,
      })
      .onConflictDoNothing({ target: [assetCandidates.eventId, assetCandidates.sourceUrl] })
      .returning({ id: assetCandidates.id });
    if (inserted.length > 0) stored++;
  }
  return stored;
}

function toSelectable(row: AssetRow, sourceTrust: number | null): AssetCandidateLike {
  return {
    id: row.id,
    sourceUrl: row.sourceUrl,
    classification: row.classification,
    isOfficial: row.isOfficial,
    isAiGenerated: row.isAiGenerated,
    width: row.width,
    height: row.height,
    confidence: row.confidence,
    sourceTrust,
  };
}

export interface CanonicalAssetResult {
  /** The image to render, or null when a placeholder should be generated. */
  url: string | null;
  assetId: string | null;
  reason: string;
  candidatesConsidered: number;
}

/**
 * Re-runs selection for an event and persists the winner.
 *
 * Safe to call whenever a new candidate appears — that is how a duplicate
 * discovered a day later upgrades an event's artwork from a venue logo to
 * the promoter's real flyer, or from a thumbnail to a full-size copy.
 */
export async function refreshCanonicalAsset(eventId: string): Promise<CanonicalAssetResult> {
  const rows = await db
    .select({ asset: assetCandidates, trust: sources.trustScore })
    .from(assetCandidates)
    .leftJoin(sources, eq(assetCandidates.sourceId, sources.id))
    .where(eq(assetCandidates.eventId, eventId));

  const selectable = rows.map((r) => toSelectable(r.asset, r.trust));
  const decision = decideEventAsset(selectable);

  if (decision.action === "generate_fallback") {
    // The placeholder is deliberately not stored as a candidate: it must
    // never be mistaken later for something a source actually published.
    await db.update(events).set({ canonicalAssetId: null }).where(eq(events.id, eventId));
    return { url: null, assetId: null, reason: decision.reason, candidatesConsidered: rows.length };
  }

  const winner = rows.find((r) => r.asset.id === decision.asset.id)!;
  await db.update(events).set({ canonicalAssetId: winner.asset.id }).where(eq(events.id, eventId));

  return {
    url: winner.asset.storageUrl ?? winner.asset.sourceUrl,
    assetId: winner.asset.id,
    reason: decision.reason,
    candidatesConsidered: rows.length,
  };
}

/**
 * The image an event should render with.
 *
 * Falls back to the legacy `events.source_image` only when an event has no
 * candidates at all — rows created before this table existed. A legacy
 * image is treated as unverified real artwork, which still beats a
 * generated placeholder but loses to any official flyer found later.
 */
export async function resolveEventImage(event: {
  id: string;
  sourceImage: string | null;
  canonicalAssetId: string | null;
}): Promise<CanonicalAssetResult> {
  if (event.canonicalAssetId) {
    const [row] = await db
      .select()
      .from(assetCandidates)
      .where(and(eq(assetCandidates.id, event.canonicalAssetId), eq(assetCandidates.eventId, event.id)))
      .limit(1);
    if (row) {
      return {
        url: row.storageUrl ?? row.sourceUrl,
        assetId: row.id,
        reason: "previously selected canonical asset",
        candidatesConsidered: 1,
      };
    }
  }

  const refreshed = await refreshCanonicalAsset(event.id);
  if (refreshed.url) return refreshed;

  if (event.sourceImage) {
    return {
      url: event.sourceImage,
      assetId: null,
      reason: "legacy source image — no asset candidates recorded for this event",
      candidatesConsidered: refreshed.candidatesConsidered,
    };
  }
  return refreshed;
}

/** Whether an incoming candidate would improve on the current selection. */
export async function wouldUpgrade(eventId: string, incoming: AssetCandidateLike): Promise<boolean> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event?.canonicalAssetId) return true;
  const [current] = await db
    .select()
    .from(assetCandidates)
    .where(eq(assetCandidates.id, event.canonicalAssetId))
    .limit(1);
  return shouldUpgradeAsset(current ? toSelectable(current, null) : null, incoming);
}

/**
 * Whether a source speaks *for* the event it is reporting.
 *
 * This is what the entity-link role is for. A venue's own page is a
 * primary channel and its artwork is the real flyer; a city tourism
 * calendar covering forty venues is secondary, and its copy of an image —
 * often a resized thumbnail — must not outrank the venue's own.
 *
 * Falls back to trust score for sources with no entity yet, so the rule
 * still behaves sensibly during migration.
 */
export async function isAuthoritativeSource(sourceId: string): Promise<boolean> {
  const [link] = await db
    .select({ role: entitySources.role })
    .from(entitySources)
    .where(eq(entitySources.sourceId, sourceId))
    .limit(1);
  if (link) return link.role === "primary";

  const [source] = await db
    .select({ trust: sources.trustScore })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);
  return (source?.trust ?? 0) >= 7;
}

/**
 * Records the image one observation carried, then re-selects the event's
 * canonical asset.
 *
 * Called on both event creation and merge, because the merge case is the
 * one that matters: a second source reporting an event we already know is
 * exactly when better artwork tends to arrive.
 */
export async function recordObservationImage(args: {
  schoolId: string;
  eventId: string;
  sourceId: string;
  rawContentId: string;
  mediaUrl: string | null;
}): Promise<void> {
  if (!args.mediaUrl) {
    // No image from this source is not a reason to do anything. Another
    // source may already have supplied one, and generating a placeholder
    // here would be the exact bug this design prevents.
    return;
  }

  const official = await isAuthoritativeSource(args.sourceId);
  await db
    .insert(assetCandidates)
    .values({
      schoolId: args.schoolId,
      eventId: args.eventId,
      sourceId: args.sourceId,
      rawContentId: args.rawContentId,
      sourceUrl: args.mediaUrl,
      classification: official ? "event_art" : "photo",
      isOfficial: official,
      isAiGenerated: false,
      confidence: official ? 0.7 : 0.4,
      origin: "linked",
    })
    .onConflictDoNothing({ target: [assetCandidates.eventId, assetCandidates.sourceUrl] });

  await refreshCanonicalAsset(args.eventId);
}
