import { DeterministicArtworkGenerator } from "./deterministic.js";
import { OpenAIArtworkGenerator } from "./openai.js";
import type { EventArtworkGenerator } from "./types.js";

export type ArtworkProviderName = "openai" | "deterministic" | "none";

export interface CreateArtworkGeneratorOptions {
  provider?: ArtworkProviderName;
  openaiApiKey?: string;
  openaiModel?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Picks an artwork generator from configuration.
 *
 * Falls back to the deterministic generator rather than to nothing,
 * because an event with no artwork renders as text on a void. The fallback
 * is honest about being deterministic — its provider name is recorded on
 * the asset — so nobody later mistakes a gradient for a model's output.
 *
 * `none` is available for a deployment that would rather have no artwork
 * than a placeholder.
 */
export function createArtworkGenerator(
  options: CreateArtworkGeneratorOptions = {},
): EventArtworkGenerator | null {
  const provider =
    options.provider ?? (process.env.ARTWORK_PROVIDER as ArtworkProviderName | undefined) ?? "deterministic";

  if (provider === "none") return null;

  if (provider === "openai") {
    const apiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey) {
      return new OpenAIArtworkGenerator({
        apiKey,
        model: options.openaiModel ?? process.env.ARTWORK_MODEL,
        fetchImpl: options.fetchImpl,
      });
    }
    console.warn(
      "[artwork] ARTWORK_PROVIDER=openai but OPENAI_API_KEY is missing — falling back to deterministic artwork.",
    );
  }

  return new DeterministicArtworkGenerator();
}
