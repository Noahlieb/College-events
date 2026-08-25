import { describe, expect, it } from "vitest";
import { SAME_IMAGE_DISTANCE, groupByImage, hammingDistance, imagesMatch } from "./phash.js";
import { selectBestCopy, selectCanonicalAsset, type AssetCandidateLike } from "./assets.js";

const asset = (o: Partial<AssetCandidateLike> & { id: string }): AssetCandidateLike => ({
  sourceUrl: `https://cdn/${o.id}.jpg`,
  classification: "flyer",
  isOfficial: true,
  isAiGenerated: false,
  confidence: 0.8,
  ...o,
});

describe("hammingDistance", () => {
  it("is zero for identical hashes", () => {
    expect(hammingDistance("ff00ff00ff00ff00", "ff00ff00ff00ff00")).toBe(0);
  });

  it("counts differing bits, not differing characters", () => {
    // 0x0 vs 0x1 is one bit, not one "character of difference".
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
  });

  it("rejects hashes of different lengths rather than comparing prefixes", () => {
    expect(() => hammingDistance("ff", "ffff")).toThrow(/different lengths/);
  });

  it("rejects non-hex input rather than silently scoring it as zero", () => {
    expect(() => hammingDistance("zzzzzzzzzzzzzzzz", "0000000000000000")).toThrow(/non-hex/);
  });
});

describe("imagesMatch", () => {
  it("treats a re-encode as the same image", () => {
    // A few bits of drift is what JPEG re-encoding actually produces.
    expect(imagesMatch("ff00ff00ff00ff00", "ff00ff00ff00ff01")).toBe(true);
  });

  it("treats a genuinely different picture as different", () => {
    expect(imagesMatch("0000000000000000", "ffffffffffffffff")).toBe(false);
  });

  it("errs toward merging, because the costs are asymmetric", () => {
    // Missing a merge means rendering a thumbnail while a full-size copy
    // sits unused. Over-merging means passing over one real flyer for
    // another real flyer. The first is the one people notice.
    expect(SAME_IMAGE_DISTANCE).toBeGreaterThanOrEqual(8);
    expect(SAME_IMAGE_DISTANCE).toBeLessThan(20);
  });

  it("never matches hashes of different lengths", () => {
    expect(imagesMatch("ff", "ffffffffffffffff")).toBe(false);
  });
});

describe("groupByImage", () => {
  it("collapses copies of one flyer into a single group", () => {
    const groups = groupByImage([
      asset({ id: "a", perceptualHash: "ff00ff00ff00ff00" }),
      asset({ id: "b", perceptualHash: "ff00ff00ff00ff01" }),
      asset({ id: "c", perceptualHash: "0000000000000000" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.length === 2)!.map((a) => a.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps un-hashed assets separate rather than guessing", () => {
    // An image we could not read might be a duplicate; assuming it is
    // would silently discard a candidate.
    const groups = groupByImage([
      asset({ id: "a", perceptualHash: "ff00ff00ff00ff00" }),
      asset({ id: "b", perceptualHash: null }),
      asset({ id: "c" }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("assigns every asset to exactly one group", () => {
    const assets = [
      asset({ id: "a", perceptualHash: "ff00ff00ff00ff00" }),
      asset({ id: "b", perceptualHash: "ff00ff00ff00ff01" }),
      asset({ id: "c", perceptualHash: "ff00ff00ff00ff02" }),
      asset({ id: "d", perceptualHash: null }),
    ];
    const ids = groupByImage(assets).flat().map((a) => a.id);
    expect(ids.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("handles an empty list", () => {
    expect(groupByImage([])).toEqual([]);
  });
});

describe("selectBestCopy", () => {
  const hash = "ff00ff00ff00ff00";

  it("prefers the higher-resolution copy", () => {
    const best = selectBestCopy([
      asset({ id: "thumb", perceptualHash: hash, width: 300, height: 300 }),
      asset({ id: "full", perceptualHash: hash, width: 2000, height: 2000 }),
    ]);
    expect(best!.id).toBe("full");
  });

  it("prefers the less-compressed file at equal dimensions", () => {
    const best = selectBestCopy([
      asset({ id: "crunchy", perceptualHash: hash, width: 1000, height: 1000, bytes: 40_000 }),
      asset({ id: "clean", perceptualHash: hash, width: 1000, height: 1000, bytes: 400_000 }),
    ]);
    expect(best!.id).toBe("clean");
  });

  it("prefers the official source's copy over a repost of the same image", () => {
    const best = selectBestCopy([
      asset({ id: "repost", perceptualHash: hash, isOfficial: false, width: 4000, height: 4000 }),
      asset({ id: "official", perceptualHash: hash, isOfficial: true, width: 1000, height: 1000 }),
    ]);
    expect(best!.id).toBe("official");
  });

  it("ignores arrival order entirely", () => {
    // "Never choose a lower-quality image merely because it arrived first."
    const small = asset({ id: "small", perceptualHash: hash, width: 300, height: 300 });
    const large = asset({ id: "large", perceptualHash: hash, width: 3000, height: 3000 });
    expect(selectBestCopy([small, large])!.id).toBe("large");
    expect(selectBestCopy([large, small])!.id).toBe("large");
  });
});

describe("selectCanonicalAsset with grouping", () => {
  it("compares images, not files", () => {
    // Three re-encodes of a logo must not out-vote one real flyer just by
    // being three.
    const logoHash = "0f0f0f0f0f0f0f0f";
    const best = selectCanonicalAsset([
      asset({ id: "logo1", classification: "logo", perceptualHash: logoHash, width: 2000, height: 2000 }),
      asset({ id: "logo2", classification: "logo", perceptualHash: logoHash, width: 1900, height: 1900 }),
      asset({ id: "logo3", classification: "logo", perceptualHash: logoHash, width: 1800, height: 1800 }),
      asset({ id: "flyer", classification: "flyer", perceptualHash: "ffffffffffffffff", width: 800, height: 800 }),
    ]);
    expect(best!.id).toBe("flyer");
  });

  it("returns the best copy of the winning image", () => {
    const flyerHash = "ff00ff00ff00ff00";
    const best = selectCanonicalAsset([
      asset({ id: "flyer-small", perceptualHash: flyerHash, width: 400, height: 400 }),
      asset({ id: "flyer-large", perceptualHash: flyerHash, width: 2400, height: 2400 }),
    ]);
    expect(best!.id).toBe("flyer-large");
  });

  it("still works when nothing has been hashed", () => {
    const best = selectCanonicalAsset([
      asset({ id: "a", classification: "logo" }),
      asset({ id: "b", classification: "flyer" }),
    ]);
    expect(best!.id).toBe("b");
  });
});
