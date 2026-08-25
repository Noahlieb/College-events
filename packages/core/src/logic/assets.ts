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
/**
 * How good a candidate is *as this event's picture*.
 *
 * The ordering turns on one question — is this image about **this event**?
 * — rather than on whether a human made it. That is what puts generated
 * art above a stock photo of the venue: a moody backdrop matched to the
 * event's category and time of night says more about Friday's party than
 * a daytime exterior shot of the building does, and far more than the
 * organization's badge.
 *
 * It is also why generating when only a venue photo exists is worth doing
 * at all. If generated art ranked below the photo, the generation would be
 * wasted work — we would spend the call and then render the photo anyway.
 *
 * Real, event-specific artwork always outranks generated art, whether or
 * not its provenance is verified.
 */
export function assetTier(candidate: AssetCandidateLike): number {
  // Generic imagery: attached to a page or an organization, not to this
  // event. A share card and a badge tell a reader nothing about the night.
  if (candidate.classification === "logo") return 0;
  if (candidate.classification === "generic_social_image") return 0;

  // A picture of the room. Real, and genuinely informative about where
  // you are going — but not about what is happening there.
  if (candidate.classification === "venue_photo") return 1;

  // Ours, synthetic, but composed for this event's category and timing.
  if (candidate.isAiGenerated || candidate.classification === "generated") return 2;

  // Legacy rows from before the venue/social split; treated as generic
  // photography, which is what they mostly were.
  if (candidate.classification === "photo") return candidate.isOfficial ? 3 : 1;

  // Art made for this event. Unverified provenance still beats anything
  // above, because someone made it for this night.
  if (!candidate.isOfficial) return 3;
  if (candidate.classification === "event_art") return 4;
  if (candidate.classification === "flyer") return 5;
  return 3;
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

/** Alias kept for callers written before `hasOfficialVisual` existed —
 * same predicate, same meaning. */
export function hasOfficialFlyer(candidates: AssetCandidateLike[]): boolean {
  return hasOfficialVisual(candidates);
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
  // The label is about provenance, not about the tier score — a tier
  // reflects "how good a picture of this event", which conflates with but
  // is not the same question as "did an authoritative source publish it".
  if (best.isOfficial) {
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

/**
 * Whether artwork may be generated for an event, and if not, why not.
 *
 * Pure and separate from the database layer on purpose: this is the rule
 * the product cares most about, the failure it prevents is silent, and a
 * rule that can only be exercised against a live database does not get
 * exercised.
 */
export type ArtworkGate =
  | { allowed: false; reason: string; code: "official_visual_exists" }
  | { allowed: false; reason: string; code: "discovery_incomplete" }
  | { allowed: false; reason: string; code: "usable_asset_exists" }
  | { allowed: false; reason: string; code: "already_generated" }
  | { allowed: true; reason: string };

export interface ArtworkGateInput {
  candidates: AssetCandidateLike[];
  /** Has every linked source been asked for artwork yet? */
  assetDiscoveryComplete: boolean;
  /** Does a generated asset already exist for these same event facts? */
  hasCurrentGeneratedAsset: boolean;
  /** Operator explicitly asked for a regeneration. */
  force?: boolean;
}

export function artworkGenerationGate(input: ArtworkGateInput): ArtworkGate {
  // Checked first and unconditionally. A flyer arriving later from a
  // duplicate source must displace artwork we generated earlier, so this
  // cannot be short-circuited by `force`.
  if (hasOfficialVisual(input.candidates)) {
    return {
      allowed: false,
      code: "official_visual_exists",
      reason: "an official flyer or official event art exists for this event",
    };
  }

  // "No image yet" and "no image anywhere" are different facts.
  if (!input.assetDiscoveryComplete) {
    return {
      allowed: false,
      code: "discovery_incomplete",
      reason: "asset discovery has not completed — another source may still supply a real visual",
    };
  }

  // Real art made for this event blocks generation even when we cannot
  // verify who published it. A repost of the promoter's actual flyer is
  // still the actual flyer.
  const eventSpecific = input.candidates.find(
    (c) => !c.isAiGenerated && (c.classification === "flyer" || c.classification === "event_art"),
  );
  if (eventSpecific) {
    return {
      allowed: false,
      code: "usable_asset_exists",
      reason: `real ${eventSpecific.classification} already exists for this event`,
    };
  }

  if (input.force) {
    return { allowed: true, reason: "operator requested regeneration" };
  }

  if (input.hasCurrentGeneratedAsset) {
    return {
      allowed: false,
      code: "already_generated",
      reason: "generated artwork already exists for these event facts",
    };
  }

  // Only generic imagery — a venue photo, a badge, a share card — or
  // nothing at all. Generating is an improvement on all of those.
  return {
    allowed: true,
    reason:
      input.candidates.length === 0
        ? "no source offered any artwork for this event"
        : "no source offered artwork made for this event",
  };
}
