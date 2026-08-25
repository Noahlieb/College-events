import { FixtureDiscoveryProvider, nullDiscoveryProvider, type WebDiscoveryProvider } from "../provider.js";
import { resilient } from "./http.js";
import { BraveDiscoveryProvider } from "./brave.js";
import { GoogleCseDiscoveryProvider } from "./google-cse.js";

/**
 * Picks a discovery provider from configuration.
 *
 * Selection is an environment variable, not a code path: adding a
 * university on a deployment with a search key configured behaves
 * identically to one without, except that discovery finds things. The
 * fallback is the null provider — never an error — because a missing
 * search key must not stop anyone onboarding a university, reviewing
 * candidates they added by hand, or crawling the sources they already have.
 *
 * Keys are read from `process.env` here and nowhere else, and this module
 * is only ever imported by server-side code (the worker CLI and Next.js
 * server actions). No key reaches the browser.
 */

export type DiscoveryProviderName = "brave" | "google_cse" | "fixture" | "none";

export interface DiscoveryProviderConfig {
  provider?: DiscoveryProviderName;
  braveApiKey?: string;
  googleApiKey?: string;
  googleEngineId?: string;
  fetchImpl?: typeof fetch;
  /** Fixtures for the `fixture` provider, in tests and local development. */
  fixtures?: Record<string, { title: string; url: string; snippet?: string }[]>;
}

export function createDiscoveryProvider(config: DiscoveryProviderConfig = {}): WebDiscoveryProvider {
  const provider =
    config.provider ?? (process.env.DISCOVERY_PROVIDER as DiscoveryProviderName | undefined) ?? "none";

  if (provider === "brave") {
    const apiKey = config.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY;
    if (apiKey) {
      return resilient(new BraveDiscoveryProvider({ apiKey, fetchImpl: config.fetchImpl }));
    }
    console.warn("[discovery] DISCOVERY_PROVIDER=brave but BRAVE_SEARCH_API_KEY is missing — discovery disabled.");
  }

  if (provider === "google_cse") {
    const apiKey = config.googleApiKey ?? process.env.GOOGLE_SEARCH_API_KEY;
    const engineId = config.googleEngineId ?? process.env.GOOGLE_SEARCH_ENGINE_ID;
    if (apiKey && engineId) {
      return resilient(new GoogleCseDiscoveryProvider({ apiKey, engineId, fetchImpl: config.fetchImpl }));
    }
    console.warn(
      "[discovery] DISCOVERY_PROVIDER=google_cse needs GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID — discovery disabled.",
    );
  }

  if (provider === "fixture") {
    return new FixtureDiscoveryProvider(config.fixtures ?? {});
  }

  return nullDiscoveryProvider;
}

/** Whether a real index is configured — for telling the operator why discovery found nothing. */
export function discoveryProviderConfigured(): boolean {
  const provider = process.env.DISCOVERY_PROVIDER;
  if (provider === "brave") return Boolean(process.env.BRAVE_SEARCH_API_KEY);
  if (provider === "google_cse") {
    return Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID);
  }
  return provider === "fixture";
}
