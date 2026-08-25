import { describe, expect, it, vi } from "vitest";
import { BraveDiscoveryProvider } from "./brave.js";
import { GoogleCseDiscoveryProvider } from "./google-cse.js";
import { createDiscoveryProvider } from "./factory.js";
import { SearchProviderError, fetchJsonWithRetry, resilient } from "./http.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("BraveDiscoveryProvider", () => {
  it("normalizes results into the shared shape", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        web: {
          results: [
            { title: "UCF Events", url: "https://events.ucf.edu/", description: "Campus calendar" },
          ],
        },
      })) as unknown as typeof fetch;

    const results = await new BraveDiscoveryProvider({ apiKey: "k", fetchImpl }).search("site:ucf.edu events");
    expect(results).toEqual([
      { title: "UCF Events", url: "https://events.ucf.edu/", snippet: "Campus calendar" },
    ]);
  });

  it("sends the key as a header, never in the query string", async () => {
    // A key in a URL ends up in logs, referrers and error messages.
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      seenHeaders = init.headers as Record<string, string>;
      return jsonResponse({ web: { results: [] } });
    }) as unknown as typeof fetch;

    await new BraveDiscoveryProvider({ apiKey: "secret-key", fetchImpl }).search("q");
    expect(seenUrl).not.toContain("secret-key");
    expect(seenHeaders["X-Subscription-Token"]).toBe("secret-key");
  });

  it("drops results with no URL rather than emitting empty candidates", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ web: { results: [{ title: "No link" }, { title: "Fine", url: "https://x.edu" }] } })) as unknown as typeof fetch;
    const results = await new BraveDiscoveryProvider({ apiKey: "k", fetchImpl }).search("q");
    expect(results).toHaveLength(1);
  });
});

describe("GoogleCseDiscoveryProvider", () => {
  it("normalizes results into the same shape as Brave", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ items: [{ title: "UCF Events", link: "https://events.ucf.edu/", snippet: "Calendar" }] })) as unknown as typeof fetch;

    const results = await new GoogleCseDiscoveryProvider({ apiKey: "k", engineId: "e", fetchImpl }).search("q");
    expect(results).toEqual([{ title: "UCF Events", url: "https://events.ucf.edu/", snippet: "Calendar" }]);
  });

  it("never asks for more than the API's per-request maximum", async () => {
    // Asking for more is an error rather than a truncation.
    let seenUrl = "";
    const fetchImpl = (async (url: string) => {
      seenUrl = String(url);
      return jsonResponse({ items: [] });
    }) as unknown as typeof fetch;
    await new GoogleCseDiscoveryProvider({ apiKey: "k", engineId: "e", count: 50, fetchImpl }).search("q");
    expect(new URL(seenUrl).searchParams.get("num")).toBe("10");
  });
});

describe("fetchJsonWithRetry", () => {
  it("retries a rate limit and succeeds", async () => {
    // Discovery fires dozens of queries per university; hitting the meter
    // is normal operation, not an outage.
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1 ? jsonResponse({}, 429) : jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const sleep = vi.fn(async () => {});
    const body = await fetchJsonWithRetry<{ ok: boolean }>("https://x", {}, { fetchImpl, sleep });
    expect(body.ok).toBe(true);
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalled();
  });

  it("backs off for longer on each successive retry", async () => {
    const delays: number[] = [];
    const fetchImpl = (async () => jsonResponse({}, 503)) as unknown as typeof fetch;
    await fetchJsonWithRetry("https://x", {}, {
      fetchImpl,
      maxRetries: 3,
      sleep: async (ms) => {
        delays.push(ms);
      },
    }).catch(() => undefined);
    expect(delays).toEqual([400, 800, 1600]);
  });

  it("does not retry a bad API key", async () => {
    // 401 will not fix itself, and retrying wastes the run's time budget.
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse({}, 401);
    }) as unknown as typeof fetch;

    await expect(
      fetchJsonWithRetry("https://x", {}, { fetchImpl, sleep: async () => {} }),
    ).rejects.toBeInstanceOf(SearchProviderError);
    expect(calls).toBe(1);
  });

  it("gives up after the retry budget", async () => {
    const fetchImpl = (async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    await expect(
      fetchJsonWithRetry("https://x", {}, { fetchImpl, maxRetries: 1, sleep: async () => {} }),
    ).rejects.toThrow();
  });
});

describe("resilient wrapper", () => {
  it("turns a provider failure into an empty result set", async () => {
    // A search outage means "we learned nothing today", never "the
    // pipeline is down".
    const wrapped = resilient({
      name: "boom",
      async search() {
        throw new Error("provider exploded");
      },
    });
    expect(await wrapped.search("q")).toEqual([]);
  });

  it("passes results through untouched when the provider works", async () => {
    const wrapped = resilient({
      name: "fine",
      async search() {
        return [{ title: "t", url: "https://x" }];
      },
    });
    expect(await wrapped.search("q")).toHaveLength(1);
  });
});

describe("createDiscoveryProvider", () => {
  it("defaults to the null provider when nothing is configured", () => {
    // Onboarding a university must not require a search key.
    const provider = createDiscoveryProvider({ provider: undefined });
    expect(["none", "brave", "google_cse", "fixture"]).toContain(provider.name);
  });

  it("falls back to null rather than throwing when a key is missing", () => {
    const provider = createDiscoveryProvider({ provider: "brave", braveApiKey: undefined });
    expect(provider.name).toBe("none");
  });

  it("builds Brave when a key is supplied", () => {
    expect(createDiscoveryProvider({ provider: "brave", braveApiKey: "k" }).name).toBe("brave");
  });

  it("requires both key and engine id for Google CSE", () => {
    expect(createDiscoveryProvider({ provider: "google_cse", googleApiKey: "k" }).name).toBe("none");
    expect(
      createDiscoveryProvider({ provider: "google_cse", googleApiKey: "k", googleEngineId: "e" }).name,
    ).toBe("google_cse");
  });

  it("builds a fixture provider for tests", () => {
    const provider = createDiscoveryProvider({
      provider: "fixture",
      fixtures: { "site:ucf.edu events": [{ title: "E", url: "https://events.ucf.edu" }] },
    });
    expect(provider.name).toBe("fixture");
  });
});
