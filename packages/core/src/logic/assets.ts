import type { AssetClassification } from "../types/enums.js";
import { groupByImage, type HashableAsset } from "./phash.js";

/**
 * Choosing which image represents an event.
 *
 * The rule the product actually cares about is simple to state and easy to
 * break by accident: **a real flyer always beats generated artwork.** The
 * way it breaks is subtle — one source reports an event with no image, the
 * renderer sees a missing image, and generates a placeholder, while a
 * second source reporting the same event had the promoter's actual flyer
 * all along. So selection happens at the *canonical event* level, across
 * every linked source, and never per-source.
 *
 * The second rule follows from the first: because a better image can
 * arrive later from a different source, selection is re-run whenever a new
 * candidate appears, and a generated image is always replaceable.
 */

/** How sure we are an image is what it claims to be. */
export interface AssetCandidateLike {
  id: string;
  sourceUrl: string;
  classification: AssetClassification;
  /** True only when the source is authoritative for this event — the
   * organizer's page, the venue's page, the platform hosting it. A repost
   * or an aggregator is not official however good its copy of the image. */
  isOfficial: boolean;
  isAiGenerated: boolean;
  width?: number | null;
  height?: number | null;
  /** 0..1 confidence in the classification. */
  confidence: number;
  /** Trust of the source that offered it, used only to break ties. */
  sourceTrust?: number | null;
  /** dHash of the pixels, when the image could be fetched and read. Lets
   * copies of one flyer be recognised as copies rather than rivals. */
  perceptualHash?: string | null;
  /** File size, the last tie-breaker between copies of identical
   * dimensions — the larger file is the less-compressed one. */
  bytes?: number | null;
}

/**
 * Rank within which *kind* of image this is. Higher wins outright — a
 * lower-resolution official flyer still beats a pristine generated image,
 * because the flyer is what the organizer actually published.
 */
export function assetTier(candidate: AssetCandidateLike): number {
  if (candidate.isAiGenerated || candidate.classification === "generated") return 0;
  // A platform's default share card and an org's badge are both real
  // images that say nothing about this event. They beat generated art
  // only because they are at least something a human published.
  if (candidate.classification === "logo") return 1;
  if (candidate.classification === "generic_social_image") return 1;
  if (!candidate.isOfficial) return 2; // real art, unverified provenance
  // A photo of the room is genuinely informative and genuinely not a
  // flyer — it sits between "some image" and "art made for this event".
  if (candidate.classification === "venue_photo") return 3;
  if (candidate.classification === "photo") return 3;
  if (candidate.classification === "event_art") return 4;
  if (candidate.classification === "flyer") return 5;
  return 2;
}

/**
 * Whether an event has an *official visual* — art an organizer or venue
 * published for this event.
 *
 * This is the predicate the artwork generator is forbidden to run against.
 * A venue photo deliberately does not count: it is a picture of the room,
 * not of the night, so generating event-specific art is a real improvement
 * over it. A logo or a platform share card likewise.
 */
export function hasOfficialVisual(candidates: AssetCandidateLike[]): boolean {
  return candidates.some(
    (c) =>
      !c.isAiGenerated &&
      c.isOfficial &&
      (c.classification === "flyer" || c.classification === "event_art"),
  );
}

function pixels(candidate: AssetCandidateLike): number {
  const w = candidate.width ?? 0;
  const h = candidate.height ?? 0;
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The best *copy* among several files that are the same picture.
 *
 * Order is deliberate and differs from choosing between different images.
 * Once we know these are all the same flyer, provenance still leads —
 * an official source's copy is the one we would rather point at — but
 * after that it is purely about which file is the better rendition:
 * resolution, then encoded quality (bytes at equal dimensions), then the
 * trust of whoever served it.
 *
 * Nothing here considers arrival order. A thumbnail that happened to be
 * seen first must never beat the full-size copy found later.
 */
export function selectBestCopy<T extends AssetCandidateLike>(copies: T[]): T | null {
  if (copies.length === 0) return null;

  return copies.reduce((best, copy) => {
    if (copy.isOfficial !== best.isOfficial) return copy.isOfficial ? copy : best;

    const pixelDiff = pixels(copy) - pixels(best);
    if (pixelDiff !== 0) return pixelDiff > 0 ? copy : best;

    // Same dimensions: the bigger file is the less-compressed one.
    const byteDiff = (copy.bytes ?? 0) - (best.bytes ?? 0);
    if (byteDiff !== 0) return byteDiff > 0 ? copy : best;

    const confidenceDiff = copy.confidence - best.confidence;
    if (confidenceDiff !== 0) return confidenceDiff > 0 ? copy : best;

    return (copy.sourceTrust ?? 0) > (best.sourceTrust ?? 0) ? copy : best;
  });
}

/**
 * The best image among everything every source offered for one event.
 *
 * Copies of the same picture are collapsed first, so the comparison is
 * between *images* rather than between files. Without that, three
 * re-encodes of one flyer look like three candidates and the winner is
 * decided by whichever copy happened to be largest, not by which artwork
 * is the right one.
 *
 * Ties between genuinely different images are broken by resolution, then
 * classification confidence, then source trust — a larger copy is
 * straightforwardly better, while trust only matters when we cannot
 * otherwise tell them apart.
 */
export function selectCanonicalAsset<T extends AssetCandidateLike>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;

  const representatives = groupByImage(candidates as (T & HashableAsset)[])
    .map((group) => selectBestCopy(group)!)
    .filter(Boolean);

  return representatives.reduce((best, candidate) => {
    const tierDiff = assetTier(candidate) - assetTier(best);
    if (tierDiff !== 0) return tierDiff > 0 ? candidate : best;

    const pixelDiff = pixels(candidate) - pixels(best);
    if (pixelDiff !== 0) return pixelDiff > 0 ? candidate : best;

    const confidenceDiff = candidate.confidence - best.confidence;
    if (confidenceDiff !== 0) return confidenceDiff > 0 ? candidate : best;

    return (candidate.sourceTrust ?? 0) > (best.sourceTrust ?? 0) ? candidate : best;
  });
}

/** Whether an event has real, non-generated artwork from an official source. */
export function hasOfficialFlyer(candidates: AssetCandidateLike[]): boolean {
  return candidates.some((c) => assetTier(c) >= 3);
}

export type AssetDecision<T> =
  | { action: "use_official"; asset: T; reason: string }
  | { action: "use_unofficial"; asset: T; reason: string }
  | { action: "generate_fallback"; reason: string };

/**
 * The rule, in one place, so it cannot be re-implemented differently in the
 * renderer, the dashboard and the worker.
 *
 * Generation is the last resort and is only reached when *no source
 * anywhere* offered usable artwork — not when the first source happened
 * not to have one.
 */
export function decideEventAsset<T extends AssetCandidateLike>(candidates: T[]): AssetDecision<T> {
  const usable = candidates.filter((c) => !c.isAiGenerated && c.classification !== "generated");

  if (usable.length === 0) {
    return {
      action: "generate_fallback",
      reason:
        candidates.length === 0
          ? "no source offered any artwork for this event"
          : "every candidate was generated artwork",
    };
  }

  const best = selectCanonicalAsset(usable)!;
  if (assetTier(best) >= 3) {
    return {
      action: "use_official",
      asset: best,
      reason: `official ${best.classification} from an authoritative source`,
    };
  }
  return {
    action: "use_unofficial",
    asset: best,
    reason: `real artwork (${best.classification}), provenance unverified — still preferred over generated art`,
  };
}

/**
 * Whether a newly-arrived candidate should replace the current choice.
 *
 * This is what lets a duplicate found a day later upgrade an event's
 * artwork: the same flyer at twice the resolution, or the promoter's real
 * flyer arriving after we had settled for a venue logo. The one thing it
 * must never do is downgrade — in particular, generated art can never
 * displace something real.
 */
export function shouldUpgradeAsset(
  current: AssetCandidateLike | null,
  incoming: AssetCandidateLike,
): boolean {
  if (!current) return true;
  const currentTier = assetTier(current);
  const incomingTier = assetTier(incoming);
  if (incomingTier !== currentTier) return incomingTier > currentTier;
  // Same tier: only a genuinely larger image is an upgrade.
  return pixels(incoming) > pixels(current);
}
