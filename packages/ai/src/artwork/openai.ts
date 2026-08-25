import {
  ARTWORK_HEIGHT,
  ARTWORK_WIDTH,
  buildArtworkPrompt,
  type ArtworkEventFacts,
  type EventArtworkGenerator,
  type GeneratedEventAsset,
} from "./types.js";

/**
 * OpenAI image generation.
 *
 * Isolated here so the rest of the system knows only `EventArtworkGenerator`.
 * The model is configurable because image models turn over quickly and a
 * pinned name in application code becomes a migration.
 */

export interface OpenAIArtworkOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ImageResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  error?: { message?: string };
}

const DEFAULT_MODEL = "gpt-image-1";

export class OpenAIArtworkGenerator implements EventArtworkGenerator {
  readonly name = "openai";
  readonly model: string;
  private readonly options: OpenAIArtworkOptions;

  constructor(options: OpenAIArtworkOptions) {
    this.options = options;
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async generate(event: ArtworkEventFacts): Promise<GeneratedEventAsset> {
    const prompt = buildArtworkPrompt(event);
    const fetchImpl = this.options.fetchImpl ?? fetch;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);

    try {
      const res = await fetchImpl("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          n: 1,
          size: `${ARTWORK_WIDTH}x${ARTWORK_HEIGHT}`,
          // Bytes rather than a URL: generated image URLs expire, and a
          // link that 404s an hour later is worse than no artwork.
          response_format: "b64_json",
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ImageResponse;
        throw new Error(
          `OpenAI image generation failed: HTTP ${res.status}${body.error?.message ? ` — ${body.error.message}` : ""}`,
        );
      }

      const body = (await res.json()) as ImageResponse;
      const encoded = body.data?.[0]?.b64_json;
      if (!encoded) throw new Error("OpenAI image generation returned no image data");

      return {
        image: Buffer.from(encoded, "base64"),
        mime: "image/png",
        width: ARTWORK_WIDTH,
        height: ARTWORK_HEIGHT,
        provider: this.name,
        model: this.model,
        // The prompt we sent, not any revision the API reports — this is
        // the record of what we asked for.
        prompt,
        generatedAt: new Date(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
