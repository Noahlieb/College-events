import type { AssetClassification } from "../types/enums.js";

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
}

/**
 * Rank within which *kind* of image this is. Higher wins outright — a
 * lower-resolution official flyer still beats a pristine generated image,
 * because the flyer is what the organizer actually published.
 */
export function assetTier(candidate: AssetCandidateLike): number {
  if (candidate.isAiGenerated || candidate.classification === "generated") return 0;
  if (candidate.classification === "logo") return 1; // better than nothing, barely
  if (!candidate.isOfficial) return 2; // real art, unverified provenance
  if (candidate.classification === "photo") return 3;
  if (candidate.classification === "event_art") return 4;
  if (candidate.classification === "flyer") return 5;
  return 2;
}

function pixels(candidate: AssetCandidateLike): number {
  const w = candidate.width ?? 0;
  const h = candidate.height ?? 0;
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The best image among everything every source offered for one event.
 *
 * Ties inside a tier are broken by resolution, then classification
 * confidence, then source trust — in that order, because a larger copy of
 * the same flyer is straightforwardly better, while trust only matters
 * when we genuinely cannot tell the images apart.
 */
export function selectCanonicalAsset<T extends AssetCandidateLike>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
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
