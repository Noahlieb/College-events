/**
 * Perceptual hashing: recognising that two files are the same picture.
 *
 * The problem this solves is concrete. One event is reported by the
 * organizer's page, the venue's page and a ticketing platform. All three
 * carry the same flyer, but at different sizes, re-encoded, sometimes
 * re-cropped by a few pixels. Byte comparison says three different images;
 * a URL comparison says three different images. The result is three
 * "candidates" for what is really one piece of artwork, and the selection
 * logic ends up choosing between copies rather than between images.
 *
 * A perceptual hash collapses them back into one group, so the question
 * becomes the right one: given that these are all the same flyer, which
 * *copy* should we render?
 *
 * The hash math lives here, without an image library, so the comparison
 * and grouping rules are testable on their own. Computing a hash from
 * actual pixels needs sharp and lives in @college-events/render.
 */

/** Hamming distance between two equal-length hex hashes. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`Cannot compare hashes of different lengths (${a.length} vs ${b.length})`);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const left = parseInt(a[i]!, 16);
    const right = parseInt(b[i]!, 16);
    // Checked before the XOR: `NaN ^ NaN` is 0 in JS, so testing the
    // result would silently score two garbage hashes as identical.
    if (Number.isNaN(left) || Number.isNaN(right)) {
      throw new Error("Hash contains a non-hex character");
    }
    let nibble = left ^ right;
    while (nibble) {
      distance += nibble & 1;
      nibble >>= 1;
    }
  }
  return distance;
}

/**
 * Distance at or below which two 64-bit dHashes are treated as the same
 * image.
 *
 * 10/64 is deliberately toward the permissive end. The cost of the two
 * errors is asymmetric: merging two genuinely different images means one
 * flyer is passed over for another real one, which is a small aesthetic
 * loss. Failing to merge two copies of the same flyer means the resolution
 * comparison never happens and we may render a thumbnail while a
 * full-resolution copy sits unused — which is the failure people actually
 * notice.
 */
export const SAME_IMAGE_DISTANCE = 10;

export function imagesMatch(a: string, b: string, threshold = SAME_IMAGE_DISTANCE): boolean {
  if (a.length !== b.length) return false;
  try {
    return hammingDistance(a, b) <= threshold;
  } catch {
    // A malformed stored hash means "cannot tell", which for grouping is
    // the same as "not a match" — the asset stays its own candidate
    // rather than being merged on bad evidence.
    return false;
  }
}

export interface HashableAsset {
  id: string;
  perceptualHash?: string | null;
}

/**
 * Groups assets that are the same picture.
 *
 * Assets with no hash are each their own group: an un-hashed image might
 * be a duplicate, and guessing that it is would silently discard a
 * candidate. Being wrong in that direction costs nothing but a redundant
 * candidate.
 */
export function groupByImage<T extends HashableAsset>(assets: T[], threshold = SAME_IMAGE_DISTANCE): T[][] {
  const groups: T[][] = [];
  const claimed = new Set<string>();

  for (const asset of assets) {
    if (claimed.has(asset.id)) continue;
    claimed.add(asset.id);

    if (!asset.perceptualHash) {
      groups.push([asset]);
      continue;
    }

    const group = [asset];
    for (const other of assets) {
      if (claimed.has(other.id) || !other.perceptualHash) continue;
      if (imagesMatch(asset.perceptualHash, other.perceptualHash, threshold)) {
        group.push(other);
        claimed.add(other.id);
      }
    }
    groups.push(group);
  }

  return groups;
}
