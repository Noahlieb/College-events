import { describe, expect, it } from "vitest";
import {
  assetTier,
  decideEventAsset,
  hasOfficialFlyer,
  selectCanonicalAsset,
  shouldUpgradeAsset,
  type AssetCandidateLike,
} from "./assets.js";

const asset = (overrides: Partial<AssetCandidateLike> & { id: string }): AssetCandidateLike => ({
  sourceUrl: `https://cdn.example/${overrides.id}.jpg`,
  classification: "flyer",
  isOfficial: true,
  isAiGenerated: false,
  confidence: 0.8,
  ...overrides,
});

const generated = (id = "gen") =>
  asset({ id, classification: "generated", isAiGenerated: true, isOfficial: false, confidence: 1 });

describe("the rule: official artwork beats generated artwork", () => {
  it("never picks generated art when a real flyer exists", () => {
    const decision = decideEventAsset([generated(), asset({ id: "flyer" })]);
    expect(decision.action).toBe("use_official");
    expect(decision.action !== "generate_fallback" && decision.asset.id).toBe("flyer");
  });

  it("prefers a small official flyer over a perfect generated image", () => {
    // Resolution never outranks provenance. The flyer is what the
    // organizer actually published.
    const decision = decideEventAsset([
      asset({ id: "gen", classification: "generated", isAiGenerated: true, width: 4000, height: 4000, confidence: 1 }),
      asset({ id: "flyer", width: 400, height: 400, confidence: 0.5 }),
    ]);
    expect(decision.action !== "generate_fallback" && decision.asset.id).toBe("flyer");
  });

  it("only generates when nothing real was offered by any source", () => {
    const decision = decideEventAsset([]);
    expect(decision.action).toBe("generate_fallback");
    expect(decision.reason).toMatch(/no source offered/);
  });

  it("generates when every candidate is itself generated", () => {
    expect(decideEventAsset([generated("a"), generated("b")]).action).toBe("generate_fallback");
  });

  it("does not generate merely because one source had no image", () => {
    // The failure this whole design exists to prevent: source A reports the
    // event with no image, and a placeholder gets made while source B had
    // the promoter's real flyer the whole time.
    const fromSourceA: AssetCandidateLike[] = [];
    const fromSourceB = [asset({ id: "real-flyer" })];
    const decision = decideEventAsset([...fromSourceA, ...fromSourceB]);
    expect(decision.action).toBe("use_official");
  });

  it("prefers unverified real artwork over generated artwork", () => {
    const decision = decideEventAsset([generated(), asset({ id: "repost", isOfficial: false })]);
    expect(decision.action).toBe("use_unofficial");
    expect(decision.reason).toMatch(/preferred over generated/);
  });
});

describe("assetTier", () => {
  it("ranks an official flyer above official event art", () => {
    expect(assetTier(asset({ id: "a", classification: "flyer" }))).toBeGreaterThan(
      assetTier(asset({ id: "b", classification: "event_art" })),
    );
  });

  it("ranks a logo barely above generated art and below real photos", () => {
    // An org's badge is not a flyer — otherwise every club meeting would
    // "have" one.
    const logo = assetTier(asset({ id: "logo", classification: "logo" }));
    expect(logo).toBeGreaterThan(assetTier(generated()));
    expect(logo).toBeLessThan(assetTier(asset({ id: "photo", classification: "photo" })));
  });

  it("ranks unofficial art below anything official", () => {
    expect(assetTier(asset({ id: "u", isOfficial: false }))).toBeLessThan(
      assetTier(asset({ id: "o", classification: "photo" })),
    );
  });
});

describe("selectCanonicalAsset — tie-breaking", () => {
  it("prefers the higher-resolution copy of the same flyer", () => {
    const best = selectCanonicalAsset([
      asset({ id: "small", width: 800, height: 800 }),
      asset({ id: "large", width: 1600, height: 1600 }),
    ]);
    expect(best!.id).toBe("large");
  });

  it("falls back to classification confidence when sizes are unknown", () => {
    const best = selectCanonicalAsset([
      asset({ id: "unsure", confidence: 0.4 }),
      asset({ id: "sure", confidence: 0.95 }),
    ]);
    expect(best!.id).toBe("sure");
  });

  it("uses source trust only as a last resort", () => {
    const best = selectCanonicalAsset([
      asset({ id: "low", sourceTrust: 2 }),
      asset({ id: "high", sourceTrust: 9 }),
    ]);
    expect(best!.id).toBe("high");
  });

  it("returns null when there is nothing to choose from", () => {
    expect(selectCanonicalAsset([])).toBeNull();
  });

  it("ignores a zero dimension rather than treating it as a size", () => {
    const best = selectCanonicalAsset([
      asset({ id: "broken", width: 0, height: 0, confidence: 0.9 }),
      asset({ id: "fine", confidence: 0.5, width: 100, height: 100 }),
    ]);
    expect(best!.id).toBe("fine");
  });
});

describe("hasOfficialFlyer", () => {
  it("is true for official event artwork", () => {
    expect(hasOfficialFlyer([asset({ id: "a" })])).toBe(true);
  });
  it("is false for a logo, a repost, or generated art", () => {
    expect(hasOfficialFlyer([asset({ id: "l", classification: "logo" })])).toBe(false);
    expect(hasOfficialFlyer([asset({ id: "r", isOfficial: false })])).toBe(false);
    expect(hasOfficialFlyer([generated()])).toBe(false);
  });
});

describe("shouldUpgradeAsset — a duplicate can improve an event", () => {
  it("takes the first candidate when there is nothing yet", () => {
    expect(shouldUpgradeAsset(null, asset({ id: "first" }))).toBe(true);
  });

  it("upgrades a logo to the promoter's real flyer found later", () => {
    const current = asset({ id: "logo", classification: "logo" });
    expect(shouldUpgradeAsset(current, asset({ id: "flyer" }))).toBe(true);
  });

  it("upgrades to a higher-resolution copy of the same flyer", () => {
    const current = asset({ id: "small", width: 600, height: 600 });
    expect(shouldUpgradeAsset(current, asset({ id: "big", width: 2000, height: 2000 }))).toBe(true);
  });

  it("never lets generated art displace something real", () => {
    // The one thing this must never do.
    const current = asset({ id: "flyer" });
    expect(shouldUpgradeAsset(current, generated())).toBe(false);
  });

  it("never downgrades an official flyer to an unofficial repost", () => {
    const current = asset({ id: "flyer" });
    expect(shouldUpgradeAsset(current, asset({ id: "repost", isOfficial: false, width: 5000, height: 5000 }))).toBe(
      false,
    );
  });

  it("does not churn on an equivalent image", () => {
    const current = asset({ id: "a", width: 1000, height: 1000 });
    expect(shouldUpgradeAsset(current, asset({ id: "b", width: 1000, height: 1000 }))).toBe(false);
  });

  it("replaces generated art as soon as anything real turns up", () => {
    expect(shouldUpgradeAsset(generated(), asset({ id: "real", isOfficial: false, classification: "photo" }))).toBe(
      true,
    );
  });
});
