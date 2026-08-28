import { and, asc, eq } from "drizzle-orm";
import { assetCandidates, db, events, sources } from "@college-events/db";
import {
  AssetDiscoveryIncompleteError,
  OfficialVisualExistsError,
  artworkInputFingerprint,
  createArtworkGenerator,
  type ArtworkEventFacts,
  type EventArtworkGenerator,
} from "@college-events/ai";
import {
  artworkGenerationGate,
  decideEventAsset,
  hasOfficialVisual,
  type AssetCandidateLike,
} from "@college-events/core";
import { assetPath, contentAddressedPath, saveAsset } from "../lib/storage.js";
import { log } from "../lib/log.js";

/**
 * The fallback lifecycle:
 *
 *   asset discovery → classification → perceptual dedup →
 *   official visual? → yes: select it / no: generate, store, select
 *
 * Every guard in here exists because the failure it prevents is silent.
 * Generating artwork for an event that already has a real flyer does not
 * error; it just quietly replaces something a human made with something a
 * model made, and nobody notices until they see the post.
 */

export type ArtworkOutcome =
  | { action: "selected_official"; assetId: string; reason: string }
  | { action: "selected_existing_generated"; assetId: string; reason: string }
  | { action: "generated"; assetId: string; reason: string }
  | { action: "skipped"; reason: string };

type AssetRow = typeof assetCandidates.$inferSelect;

function toSelectable(row: AssetRow, sourceTrust: number | null): AssetCandidateLike {
  return {
    id: row.id,
    sourceUrl: row.sourceUrl,
    classification: row.classification,
    isOfficial: row.isOfficial,
    isAiGenerated: row.isAiGenerated,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    perceptualHash: row.perceptualHash,
    confidence: row.confidence,
    sourceTrust,
  };
}

function factsFor(event: typeof events.$inferSelect): ArtworkEventFacts {
  return {
    id: event.id,
    name: event.name,
    category: event.category,
    venue: event.venue,
    city: event.city,
    startAt: event.startAt.toISOString(),
    description: event.description,
    adjustmentComment: event.artworkComment,
  };
}

/**
 * Brings one event's artwork to a decided state.
 *
 * Safe and cheap to call repeatedly: an event that already has a valid
 * generated asset for the same facts is left alone. That idempotency is
 * the difference between a nightly worker run costing nothing and it
 * redrawing every event's picture every night.
 */
export async function resolveEventArtwork(
  eventId: string,
  options: {
    generator?: EventArtworkGenerator | null;
    /** Explicit operator request — regenerates even if one already exists. */
    force?: boolean;
    schoolShortName?: string;
  } = {},
): Promise<ArtworkOutcome> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return { action: "skipped", reason: "event not found" };

  const rows = await db
    .select({ asset: assetCandidates, trust: sources.trustScore })
    .from(assetCandidates)
    .leftJoin(sources, eq(assetCandidates.sourceId, sources.id))
    .where(eq(assetCandidates.eventId, eventId));

  const candidates = rows.map((r) => toSelectable(r.asset, r.trust));

  // ── Guard 1: a real visual always wins ───────────────────────────
  // Checked before anything else, and re-checked every call, because the
  // whole point is that a flyer arriving later from a duplicate source
  // must displace artwork we generated earlier.
  if (hasOfficialVisual(candidates)) {
    const decision = decideEventAsset(candidates);
    if (decision.action !== "generate_fallback") {
      await db
        .update(events)
        .set({
          canonicalAssetId: decision.asset.id,
          selectedAssetReason: decision.reason,
          // If we had generated something, it is now superseded rather
          // than deleted — the row stays for provenance.
          generationStatus: "not_needed",
        })
        .where(eq(events.id, eventId));
      return { action: "selected_official", assetId: decision.asset.id, reason: decision.reason };
    }
  }

  // ── Guard 2: do not generate before every source has been asked ──
  // "No image yet" and "no image anywhere" are different facts. Generating
  // on the first is the bug this pipeline exists to prevent.
  if (event.assetDiscoveryStatus !== "complete") {
    return {
      action: "skipped",
      reason: "asset discovery has not completed — another source may still supply a real flyer",
    };
  }

  // ── Guard 3: idempotency ─────────────────────────────────────────
  const fingerprint = artworkInputFingerprint(factsFor(event));
  const existingGenerated = rows.find((r) => r.asset.isAiGenerated);

  if (!options.force && existingGenerated && event.generationInputHash === fingerprint) {
    if (event.canonicalAssetId !== existingGenerated.asset.id) {
      await db
        .update(events)
        .set({
          canonicalAssetId: existingGenerated.asset.id,
          selectedAssetReason: "generated artwork — no source offered a real visual",
        })
        .where(eq(events.id, eventId));
    }
    return {
      action: "selected_existing_generated",
      assetId: existingGenerated.asset.id,
      reason: "generated artwork already exists for these event facts",
    };
  }

  // Anything real, even a venue photo, beats generating. Only when the
  // decision itself says "generate" do we spend anything.
  const decision = decideEventAsset(candidates);
  if (decision.action !== "generate_fallback") {
    await db
      .update(events)
      .set({
        canonicalAssetId: decision.asset.id,
        selectedAssetReason: decision.reason,
        generationStatus: "not_needed",
      })
      .where(eq(events.id, eventId));
    return { action: "selected_official", assetId: decision.asset.id, reason: decision.reason };
  }

  const generator = options.generator ?? createArtworkGenerator();
  if (!generator) {
    await db.update(events).set({ generationStatus: "not_needed" }).where(eq(events.id, eventId));
    return { action: "skipped", reason: "no artwork generator configured" };
  }

  return generateAndStore(event, generator, fingerprint, options.schoolShortName);
}

async function generateAndStore(
  event: typeof events.$inferSelect,
  generator: EventArtworkGenerator,
  fingerprint: string,
  schoolShortName?: string,
): Promise<ArtworkOutcome> {
  const facts = factsFor(event);

  try {
    // Belt and braces: assertGenerationAllowed re-reads the candidates
    // rather than trusting the caller's snapshot, because the caller and
    // the generation call are separated by a network round trip during
    // which a crawl may have landed a real flyer.
    await assertGenerationAllowed(event.id);

    const generated = await generator.generate(facts);
    const extension = generated.mime === "image/svg+xml" ? "svg" : "png";
    const path = contentAddressedPath(
      assetPath(schoolShortName ?? "shared", "events", event.id, `generated.${extension}`),
      generated.image,
    );
    const storageUrl = await saveAsset(path, generated.image);

    const [asset] = await db
      .insert(assetCandidates)
      .values({
        schoolId: event.schoolId,
        eventId: event.id,
        sourceId: null,
        rawContentId: null,
        sourceUrl: storageUrl,
        storageUrl,
        width: generated.width,
        height: generated.height,
        mime: generated.mime,
        classification: "generated",
        isOfficial: false,
        isAiGenerated: true,
        confidence: 1,
        origin: "generated",
        generationProvider: generated.provider,
        generationModel: generated.model,
        generationPrompt: generated.prompt,
        generatedAt: generated.generatedAt,
      })
      .onConflictDoUpdate({
        target: [assetCandidates.eventId, assetCandidates.sourceUrl],
        set: { generatedAt: generated.generatedAt },
      })
      .returning();

    if (!asset) throw new Error("generated asset row was not written");

    await db
      .update(events)
      .set({
        canonicalAssetId: asset.id,
        selectedAssetReason: `generated by ${generated.provider}/${generated.model} — no source offered a real visual`,
        generationStatus: "generated",
        generationInputHash: fingerprint,
      })
      .where(eq(events.id, event.id));

    return {
      action: "generated",
      assetId: asset.id,
      reason: `generated by ${generated.provider}/${generated.model}`,
    };
  } catch (err) {
    await db
      .update(events)
      .set({ generationStatus: "failed" })
      .where(eq(events.id, event.id));
    await log(event.schoolId, "error", "artwork", `Artwork generation failed: ${(err as Error).message}`, {
      eventId: event.id,
    });
    return { action: "skipped", reason: `generation failed: ${(err as Error).message}` };
  }
}

/**
 * Throws if generation is not permitted for this event.
 *
 * Exported and re-reading from the database on purpose. This is the
 * programmatic prohibition, and it must not be satisfiable by a caller
 * passing a stale list of candidates.
 */
export async function assertGenerationAllowed(eventId: string): Promise<void> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new Error(`Unknown event ${eventId}`);

  if (event.assetDiscoveryStatus !== "complete") {
    throw new AssetDiscoveryIncompleteError(eventId);
  }

  const rows = await db.select().from(assetCandidates).where(eq(assetCandidates.eventId, eventId));
  const candidates = rows.map((row) => toSelectable(row, null));

  const gate = artworkGenerationGate({
    candidates,
    assetDiscoveryComplete: event.assetDiscoveryStatus === "complete",
    // Deliberately false: this assertion answers "is generating allowed at
    // all", not "should we skip because one already exists".
    hasCurrentGeneratedAsset: false,
  });

  if (!gate.allowed && gate.code === "official_visual_exists") {
    throw new OfficialVisualExistsError(eventId);
  }
  if (!gate.allowed && gate.code === "discovery_incomplete") {
    throw new AssetDiscoveryIncompleteError(eventId);
  }
}

/** Brings every event in a post to a decided artwork state. */
export async function resolveArtworkForEvents(
  eventIds: string[],
  options: { generator?: EventArtworkGenerator | null; schoolShortName?: string } = {},
): Promise<ArtworkOutcome[]> {
  const outcomes: ArtworkOutcome[] = [];
  for (const id of eventIds) {
    outcomes.push(await resolveEventArtwork(id, options));
  }
  return outcomes;
}

/**
 * Attaches an admin-uploaded image as this event's artwork, on the same
 * footing as a scraped flyer (isOfficial: true) rather than as a separate
 * kind of override. That's deliberate: the "a real flyer always wins"
 * guard in resolveEventArtwork/Guard 1 already exists and already does
 * exactly what a manual pick needs — sticking against future AI
 * regeneration — so this reuses it instead of inventing a second
 * always-wins flag that the rest of the pipeline would need to know about.
 */
export async function attachManualArtwork(
  eventId: string,
  image: Buffer,
  mime: string,
  schoolShortName?: string,
): Promise<ArtworkOutcome> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return { action: "skipped", reason: "event not found" };

  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = contentAddressedPath(
    assetPath(schoolShortName ?? "shared", "events", eventId, `manual.${extension}`),
    image,
  );
  const storageUrl = await saveAsset(path, image);

  const [asset] = await db
    .insert(assetCandidates)
    .values({
      schoolId: event.schoolId,
      eventId: event.id,
      sourceId: null,
      rawContentId: null,
      sourceUrl: storageUrl,
      storageUrl,
      mime,
      classification: "flyer",
      isOfficial: true,
      isAiGenerated: false,
      confidence: 1,
      origin: "manual_upload",
    })
    .onConflictDoUpdate({
      target: [assetCandidates.eventId, assetCandidates.sourceUrl],
      set: { classification: "flyer", isOfficial: true },
    })
    .returning();
  if (!asset) throw new Error("uploaded asset row was not written");

  const reason = "manually uploaded by an admin";
  await db
    .update(events)
    .set({ canonicalAssetId: asset.id, selectedAssetReason: reason, generationStatus: "not_needed" })
    .where(eq(events.id, eventId));

  return { action: "selected_official", assetId: asset.id, reason };
}

/**
 * Every image ever stored for an event, oldest first — every past AI
 * generation and every uploaded/scraped flyer is already preserved as its
 * own row (storage.ts's content-addressed paths mean a regenerate never
 * overwrites the previous file), just never surfaced anywhere before now.
 * This is what lets the dashboard offer "revert to an earlier version"
 * without any new storage or schema.
 */
export async function listEventArtwork(eventId: string) {
  return db.select().from(assetCandidates).where(eq(assetCandidates.eventId, eventId)).orderBy(asc(assetCandidates.createdAt));
}

/**
 * Points an event at a specific existing candidate — "use this one" from
 * the history list, including reverting to an earlier generation or back
 * to the original scraped flyer. Refuses to select generated/unofficial
 * art while a *different* official visual exists among the event's
 * candidates, so this can't be used to quietly break the "a real flyer
 * always wins" rule the rest of the pipeline enforces — remove or replace
 * the official image first if AI art is genuinely what's wanted instead.
 */
export async function selectEventArtwork(eventId: string, assetId: string): Promise<ArtworkOutcome> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return { action: "skipped", reason: "event not found" };

  const [asset] = await db
    .select()
    .from(assetCandidates)
    .where(and(eq(assetCandidates.id, assetId), eq(assetCandidates.eventId, eventId)))
    .limit(1);
  if (!asset) return { action: "skipped", reason: "asset not found for this event" };

  if (!asset.isOfficial) {
    const others = (await db.select().from(assetCandidates).where(eq(assetCandidates.eventId, eventId)))
      .filter((r) => r.id !== asset.id)
      .map((r) => toSelectable(r, null));
    if (hasOfficialVisual(others)) {
      return {
        action: "skipped",
        reason: "an official flyer exists for this event — remove or replace it first to use generated art instead",
      };
    }
  }

  const reason = "manually selected by an admin";
  await db
    .update(events)
    .set({
      canonicalAssetId: asset.id,
      selectedAssetReason: reason,
      generationStatus: asset.isAiGenerated ? "generated" : "not_needed",
    })
    .where(eq(events.id, eventId));

  return { action: asset.isOfficial ? "selected_official" : "selected_existing_generated", assetId: asset.id, reason };
}
