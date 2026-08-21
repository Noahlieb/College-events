import { MockAIProvider } from "./providers/mock.js";
import { AnthropicAIProvider } from "./providers/anthropic.js";
import { OpenAIAIProvider } from "./providers/openai.js";
import type { AIProvider } from "./types.js";

export interface CreateAIProviderOptions {
  provider?: "anthropic" | "openai" | "mock";
  anthropicApiKey?: string;
  anthropicModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
}

/**
 * Central place the rest of the app asks for an AIProvider. Reads env vars
 * by default so swapping providers is a config change, not a code change
 * (spec §6). Falls back to the mock provider whenever the requested
 * provider's API key is missing, so the pipeline never hard-blocks on
 * missing credentials (spec §47).
 */
export function createAIProvider(options: CreateAIProviderOptions = {}): AIProvider {
  const provider = options.provider ?? (process.env.AI_PROVIDER as CreateAIProviderOptions["provider"]) ?? "mock";

  if (provider === "anthropic") {
    const apiKey = options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      return new AnthropicAIProvider({
        apiKey,
        model: options.anthropicModel ?? process.env.ANTHROPIC_MODEL,
      });
    }
    console.warn("[ai] AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing — falling back to MockAIProvider.");
  }

  if (provider === "openai") {
    const apiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey) {
      return new OpenAIAIProvider({
        apiKey,
        model: options.openaiModel ?? process.env.OPENAI_MODEL,
      });
    }
    console.warn("[ai] AI_PROVIDER=openai but OPENAI_API_KEY is missing — falling back to MockAIProvider.");
  }

  return new MockAIProvider();
}
