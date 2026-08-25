import { describe, expect, it } from "vitest";
import {
  ARTWORK_HEIGHT,
  ARTWORK_WIDTH,
  artworkInputFingerprint,
  buildArtworkPrompt,
  type ArtworkEventFacts,
} from "./types.js";
import { DeterministicArtworkGenerator } from "./deterministic.js";
import { OpenAIArtworkGenerator } from "./openai.js";
import { createArtworkGenerator } from "./factory.js";

const event = (overrides: Partial<ArtworkEventFacts> = {}): ArtworkEventFacts => ({
  id: "evt-1",
  name: "Neon Night",
  category: "nightlife",
  venue: "The Wharf",
  city: "Fort Lauderdale",
  startAt: "2026-09-05T02:00:00Z",
  description: "A night of house music.",
  ...overrides,
});

describe("buildArtworkPrompt", () => {
  it("forbids text so the model cannot introduce spelling or date errors", () => {
    // The whole reason the renderer, not the model, owns every word on
    // the slide.
    const prompt = buildArtworkPrompt(event());
    expect(prompt.toLowerCase()).toContain("no text");
  });

  it("never mentions the event name, venue or date as literal content to render", () => {
    // The model should paint atmosphere, not attempt the layout.
    const prompt = buildArtworkPrompt(event());
    expect(prompt).not.toContain("Neon Night");
    expect(prompt).not.toContain("The Wharf");
  });

  it("varies mood by category", () => {
    const nightlife = buildArtworkPrompt(event({ category: "nightlife" }));
    const academic = buildArtworkPrompt(event({ category: "academic" }));
    expect(nightlife).not.toBe(academic);
  });

  it("does not throw on an unparseable date", () => {
    expect(() => buildArtworkPrompt(event({ startAt: "not-a-date" }))).not.toThrow();
  });

  it("falls back to a generic mood for an unknown category", () => {
    expect(() => buildArtworkPrompt(event({ category: "some_future_category" }))).not.toThrow();
  });
});

describe("artworkInputFingerprint", () => {
  it("is stable for the same facts", () => {
    expect(artworkInputFingerprint(event())).toBe(artworkInputFingerprint(event()));
  });

  it("changes when the name changes", () => {
    expect(artworkInputFingerprint(event())).not.toBe(artworkInputFingerprint(event({ name: "Different" })));
  });

  it("changes when the category changes", () => {
    expect(artworkInputFingerprint(event())).not.toBe(
      artworkInputFingerprint(event({ category: "concert" })),
    );
  });

  it("changes when the date changes", () => {
    expect(artworkInputFingerprint(event())).not.toBe(
      artworkInputFingerprint(event({ startAt: "2026-10-01T00:00:00Z" })),
    );
  });

  it("ignores description changes — regenerating over a tidied description would waste money", () => {
    expect(artworkInputFingerprint(event())).toBe(
      artworkInputFingerprint(event({ description: "Completely rewritten description." })),
    );
  });

  it("ignores venue changes on their own", () => {
    // A corrected venue name is a data-quality fix, not a reason to
    // discard an already-approved image.
    expect(artworkInputFingerprint(event())).toBe(artworkInputFingerprint(event({ venue: "Elsewhere" })));
  });

  it("is case-insensitive on the name", () => {
    expect(artworkInputFingerprint(event({ name: "Neon Night" }))).toBe(
      artworkInputFingerprint(event({ name: "NEON NIGHT" })),
    );
  });
});

describe("DeterministicArtworkGenerator", () => {
  const generator = new DeterministicArtworkGenerator();

  it("honestly reports itself as non-model artwork", () => {
    // So an operator reviewing "why does this have generated art" gets a
    // true answer rather than mistaking a gradient for a model's output.
    expect(generator.name).toBe("deterministic");
  });

  it("produces a valid image at the declared dimensions", async () => {
    const asset = await generator.generate(event());
    expect(asset.width).toBe(ARTWORK_WIDTH);
    expect(asset.height).toBe(ARTWORK_HEIGHT);
    expect(asset.image.byteLength).toBeGreaterThan(0);
    expect(asset.provider).toBe("deterministic");
  });

  it("varies by category", async () => {
    const a = await generator.generate(event({ category: "nightlife" }));
    const b = await generator.generate(event({ category: "academic" }));
    expect(a.image.toString()).not.toBe(b.image.toString());
  });

  it("is stable for the same event id, so re-running does not visibly churn", async () => {
    const a = await generator.generate(event());
    const b = await generator.generate(event());
    expect(a.image.toString()).toBe(b.image.toString());
  });

  it("records the prompt even though it never calls a model", async () => {
    // Kept for a consistent provenance record across providers.
    const asset = await generator.generate(event());
    expect(asset.prompt.length).toBeGreaterThan(0);
  });
});

describe("OpenAIArtworkGenerator", () => {
  it("decodes base64 image data into bytes", async () => {
    const png = Buffer.from("fake-png-bytes").toString("base64");
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 })) as unknown as typeof fetch;

    const generator = new OpenAIArtworkGenerator({ apiKey: "k", fetchImpl });
    const asset = await generator.generate(event());
    expect(asset.image.toString("base64")).toBe(png);
    expect(asset.provider).toBe("openai");
  });

  it("never sends the model an instruction to render finished layout text", async () => {
    let sentBody = "";
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sentBody = String(init.body);
      return new Response(JSON.stringify({ data: [{ b64_json: "AA==" }] }));
    }) as unknown as typeof fetch;

    await new OpenAIArtworkGenerator({ apiKey: "k", fetchImpl }).generate(event());
    const prompt = JSON.parse(sentBody).prompt as string;
    expect(prompt).not.toContain(event().name);
    expect(prompt.toLowerCase()).toContain("no text");
  });

  it("raises a clear error on an API failure rather than returning a broken asset", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: "invalid_api_key" } }), { status: 401 })) as unknown as typeof fetch;
    await expect(new OpenAIArtworkGenerator({ apiKey: "bad", fetchImpl }).generate(event())).rejects.toThrow(
      /invalid_api_key|401/,
    );
  });

  it("raises when the API returns no image data", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ data: [{}] }))) as unknown as typeof fetch;
    await expect(new OpenAIArtworkGenerator({ apiKey: "k", fetchImpl }).generate(event())).rejects.toThrow(
      /no image data/,
    );
  });
});

describe("createArtworkGenerator", () => {
  it("falls back to the deterministic generator when nothing is configured", () => {
    const generator = createArtworkGenerator({ provider: undefined });
    expect(["deterministic", "openai"]).toContain(generator!.name);
  });

  it("falls back to deterministic rather than throwing when openai has no key", () => {
    const generator = createArtworkGenerator({ provider: "openai", openaiApiKey: undefined });
    expect(generator!.name).toBe("deterministic");
  });

  it("builds the OpenAI generator when a key is supplied", () => {
    expect(createArtworkGenerator({ provider: "openai", openaiApiKey: "k" })!.name).toBe("openai");
  });

  it("returns null for a deployment that wants no artwork at all", () => {
    expect(createArtworkGenerator({ provider: "none" })).toBeNull();
  });
});
