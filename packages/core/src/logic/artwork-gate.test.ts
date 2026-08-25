import { describe, expect, it, vi } from "vitest";
import {
  artworkGenerationGate,
  decideEventAsset,
  hasOfficialVisual,
  shouldUpgradeAsset,
  type AssetCandidateLike,
} from "./assets.js";

const asset = (o: Partial<AssetCandidateLike> & { id: string }): AssetCandidateLike => ({
  sourceUrl: `https://cdn/${o.id}.jpg`,
  classification: "flyer",
  isOfficial: true,
  isAiGenerated: false,
  confidence: 0.8,
  ...o,
});

const officialFlyer = () => asset({ id: "flyer", classification: "flyer", isOfficial: true });
const officialEventArt = () => asset({ id: "art", classification: "event_art", isOfficial: true });
const venuePhoto = () => asset({ id: "venue", classification: "venue_photo", isOfficial: true });
const socialCard = () => asset({ id: "og", classification: "generic_social_image", isOfficial: false });
const generated = () =>
  asset({ id: "gen", classification: "generated", isAiGenerated: true, isOfficial: false, confidence: 1 });

/**
 * A stand-in for the real generator. Every test that asserts "the
 * generator is NOT called" uses this, because asserting on the gate's
 * return value alone would not catch a caller that ignored it.
 */
function generatorSpy() {
  return vi.fn(async () => ({ image: Buffer.alloc(0) }));
}

/** The caller contract, in one place, exactly as the pipeline applies it. */
async function runPipeline(
  input: Parameters<typeof artworkGenerationGate>[0],
  generate: ReturnType<typeof generatorSpy>,
) {
  const gate = artworkGenerationGate(input);
  if (gate.allowed) await generate();
  return gate;
}

describe("the generator is not called when a real visual exists", () => {
  it("official flyer exists → generator is NOT called", async () => {
    const generate = generatorSpy();
    const gate = await runPipeline(
      { candidates: [officialFlyer()], assetDiscoveryComplete: true, hasCurrentGeneratedAsset: false },
      generate,
    );
    expect(generate).not.toHaveBeenCalled();
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.code).toBe("official_visual_exists");
  });

  it("official event art exists → generator is NOT called", async () => {
    const generate = generatorSpy();
    const gate = await runPipeline(
      { candidates: [officialEventArt()], assetDiscoveryComplete: true, hasCurrentGeneratedAsset: false },
      generate,
    );
    expect(generate).not.toHaveBeenCalled();
    expect(gate.allowed === false && gate.code).toBe("official_visual_exists");
  });

  it("a forced regeneration still cannot override an official visual", async () => {
    // `force` exists for "this generated image is bad, make another". It
    // is not authority to overwrite something a human published.
    const generate = generatorSpy();
    await runPipeline(
      {
        candidates: [officialFlyer()],
        assetDiscoveryComplete: true,
        hasCurrentGeneratedAsset: true,
        force: true,
      },
      generate,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("an official flyer buried among many candidates still blocks generation", async () => {
    const generate = generatorSpy();
    await runPipeline(
      {
        candidates: [socialCard(), venuePhoto(), generated(), officialFlyer()],
        assetDiscoveryComplete: true,
        hasCurrentGeneratedAsset: true,
      },
      generate,
    );
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("the generator runs when nothing real is available", () => {
  it("no images at all → fallback generation occurs", async () => {
    const generate = generatorSpy();
    const gate = await runPipeline(
      { candidates: [], assetDiscoveryComplete: true, hasCurrentGeneratedAsset: false },
      generate,
    );
    expect(gate.allowed).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("only a venue photograph → fallback generation may occur", async () => {
    // A picture of the room is not a picture of the night, so event-
    // specific art is a genuine improvement over it.
    const generate = generatorSpy();
    const gate = await runPipeline(
      { candidates: [venuePhoto()], assetDiscoveryComplete: true, hasCurrentGeneratedAsset: false },
      generate,
    );
    expect(gate.allowed).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("only a platform share card → fallback generation may occur", async () => {
    const generate = generatorSpy();
    const gate = await runPipeline(
      { candidates: [socialCard()], assetDiscoveryComplete: true, hasCurrentGeneratedAsset: false },
      generate,
    );
    expect(gate.allowed).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
  });
});

describe("generation waits for discovery to finish", () => {
  it("does not generate before every source has been asked", async () => {
    // The silent bug: source A reports an event with no image, we generate
    // immediately, and source B had the promoter's flyer all along.
    const generate = generatorSpy();
    const gate = await runPipeline(
      { candidates: [], assetDiscoveryComplete: false, hasCurrentGeneratedAsset: false },
      generate,
    );
    expect(generate).not.toHaveBeenCalled();
    expect(gate.allowed === false && gate.code).toBe("discovery_incomplete");
  });

  it("generates once discovery completes with nothing found", async () => {
    const generate = generatorSpy();
    await runPipeline(
      { candidates: [], assetDiscoveryComplete: true, hasCurrentGeneratedAsset: false },
      generate,
    );
    expect(generate).toHaveBeenCalledOnce();
  });
});

describe("generated asset idempotency", () => {
  it("does not regenerate when artwork already exists for these facts", async () => {
    // A nightly worker run must not redraw every event's picture.
    const generate = generatorSpy();
    const gate = await runPipeline(
      { candidates: [generated()], assetDiscoveryComplete: true, hasCurrentGeneratedAsset: true },
      generate,
    );
    expect(generate).not.toHaveBeenCalled();
    expect(gate.allowed === false && gate.code).toBe("already_generated");
  });

  it("regenerates when an operator explicitly asks", async () => {
    const generate = generatorSpy();
    await runPipeline(
      {
        candidates: [generated()],
        assetDiscoveryComplete: true,
        hasCurrentGeneratedAsset: true,
        force: true,
      },
      generate,
    );
    expect(generate).toHaveBeenCalledOnce();
  });

  it("regenerates when the event facts behind the artwork changed", async () => {
    // hasCurrentGeneratedAsset is false when the fingerprint no longer
    // matches — the caller computes that, the gate acts on it.
    const generate = generatorSpy();
    await runPipeline(
      { candidates: [generated()], assetDiscoveryComplete: true, hasCurrentGeneratedAsset: false },
      generate,
    );
    expect(generate).toHaveBeenCalledOnce();
  });

  it("calling the pipeline repeatedly generates at most once", async () => {
    const generate = generatorSpy();
    let hasGenerated = false;
    for (let run = 0; run < 5; run++) {
      const gate = await runPipeline(
        {
          candidates: hasGenerated ? [generated()] : [],
          assetDiscoveryComplete: true,
          hasCurrentGeneratedAsset: hasGenerated,
        },
        generate,
      );
      if (gate.allowed) hasGenerated = true;
    }
    expect(generate).toHaveBeenCalledOnce();
  });
});

describe("a late official flyer replaces generated artwork", () => {
  it("switches the canonical selection to the real flyer", () => {
    // The duplicate-source case: we generated art on Monday, and on
    // Wednesday the promoter's page turns up with the actual flyer.
    const current = generated();
    const late = officialFlyer();
    expect(shouldUpgradeAsset(current, late)).toBe(true);

    const decision = decideEventAsset([current, late]);
    expect(decision.action).toBe("use_official");
    expect(decision.action !== "generate_fallback" && decision.asset.id).toBe("flyer");
  });

  it("stops further generation once the real flyer has arrived", async () => {
    const generate = generatorSpy();
    await runPipeline(
      {
        candidates: [generated(), officialFlyer()],
        assetDiscoveryComplete: true,
        hasCurrentGeneratedAsset: false,
      },
      generate,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("generated artwork never permanently outranks a later official flyer", () => {
    expect(hasOfficialVisual([generated()])).toBe(false);
    expect(hasOfficialVisual([generated(), officialEventArt()])).toBe(true);
  });

  it("lets generated art displace a venue photo, since neither is official and generated is more event-specific", () => {
    // A venue photo is a picture of the room, not of the night. Generated
    // art matched to the event's category and timing outranks it — this
    // is the same reasoning that permits generation when only a venue
    // photo exists in the first place.
    expect(shouldUpgradeAsset(venuePhoto(), generated())).toBe(true);
  });

  it("does not churn between two generic non-official images", () => {
    // Two things at the same tier should not flip-flop on every run.
    expect(shouldUpgradeAsset(socialCard(), asset({ id: "logo2", classification: "logo" }))).toBe(false);
  });
});

describe("hasOfficialVisual is the predicate the gate depends on", () => {
  it("counts official flyers and official event art", () => {
    expect(hasOfficialVisual([officialFlyer()])).toBe(true);
    expect(hasOfficialVisual([officialEventArt()])).toBe(true);
  });

  it("does not count a venue photo, a logo, a share card or generated art", () => {
    expect(hasOfficialVisual([venuePhoto()])).toBe(false);
    expect(hasOfficialVisual([socialCard()])).toBe(false);
    expect(hasOfficialVisual([asset({ id: "l", classification: "logo" })])).toBe(false);
    expect(hasOfficialVisual([generated()])).toBe(false);
  });

  it("does not count an unofficial repost of a flyer", () => {
    // Provenance is the claim being made; a repost cannot make it.
    expect(hasOfficialVisual([asset({ id: "r", classification: "flyer", isOfficial: false })])).toBe(false);
  });
});
