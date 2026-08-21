import type { PhantomBusterPost } from "./phantombuster.js";

export interface PhantomBusterClientOptions {
  apiKey: string;
  /** https://api.phantombuster.com/api/v2 by default. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface WaitForCompletionOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class PhantomBusterApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "PhantomBusterApiError";
  }
}

interface ContainerStatusResponse {
  status?: string;
  containerStatus?: string;
  output?: string;
  resultObject?: unknown;
  [key: string]: unknown;
}

const TERMINAL_SUCCESS = /finish|success|done/i;
const TERMINAL_ERROR = /error|fail|abort/i;

/**
 * Thin client over PhantomBuster's launch/poll/fetch API (v2). This
 * automates the "launch an existing agent, wait for it, get the results"
 * loop so nobody has to manually run a Phantom and download a JSON file —
 * see packages/ingestion/src/phantombuster.ts for the (unchanged) mapping
 * from PhantomBuster's row shape into DiscoveredItems.
 *
 * IMPORTANT — response field names below (`status`/`containerStatus`,
 * `resultObject`, etc.) are taken from PhantomBuster's public docs and
 * support articles, not verified against a live account/response in this
 * environment (phantombuster.com is unreachable from here — see the
 * network policy note in README's PhantomBuster section). Confirm against
 * one real run before relying on this in production; the status-matching
 * below is intentionally loose (regex over common wording) to reduce the
 * chance of silently hanging on an unrecognized status string, but a
 * mismatched `resultObject` shape would need a one-line fix here.
 */
export class PhantomBusterClient {
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(options: PhantomBusterClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.phantombuster.com/api/v2";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-Phantombuster-Key": this.apiKey,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!res.ok) {
      throw new PhantomBusterApiError(`PhantomBuster API ${path} failed: HTTP ${res.status}`, res.status, body);
    }
    return body as T;
  }

  /** Launches an already-configured agent (set up once in PhantomBuster's
   * UI — see README). Returns immediately with a containerId; the run
   * itself is asynchronous. `argumentOverrides` is passed through as-is if
   * given, letting a specific agent's saved arguments be overridden per
   * launch (e.g. a different profile list) without hardcoding any
   * particular Phantom's argument schema here. */
  async launchAgent(agentId: string, argumentOverrides?: Record<string, unknown>): Promise<{ containerId: string }> {
    const body: Record<string, unknown> = { id: agentId };
    if (argumentOverrides) body.argument = argumentOverrides;
    const response = await this.request<{ containerId?: string; id?: string }>("/agents/launch", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const containerId = response.containerId ?? response.id;
    if (!containerId) {
      throw new PhantomBusterApiError("PhantomBuster launch response had no containerId", undefined, response);
    }
    return { containerId };
  }

  /** One status check against a running/finished container. */
  async getContainerStatus(containerId: string, fromOutputPos = 0): Promise<ContainerStatusResponse> {
    return this.request<ContainerStatusResponse>(
      `/containers/fetch-output?id=${encodeURIComponent(containerId)}&fromOutputPos=${fromOutputPos}`,
    );
  }

  /** Polls until the container reaches a terminal state, then returns its
   * resultObject. Throws on error/timeout rather than returning a partial
   * result — callers should not have to guess whether data is complete. */
  async waitForCompletion(containerId: string, opts: WaitForCompletionOptions = {}): Promise<unknown> {
    const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const statusResponse = await this.getContainerStatus(containerId);
      const status = String(statusResponse.status ?? statusResponse.containerStatus ?? "");

      if (TERMINAL_ERROR.test(status)) {
        throw new PhantomBusterApiError(`PhantomBuster container ${containerId} finished with error status "${status}"`, undefined, statusResponse);
      }
      if (TERMINAL_SUCCESS.test(status)) {
        return statusResponse.resultObject;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new PhantomBusterApiError(`PhantomBuster container ${containerId} did not finish within ${timeoutMs}ms`);
  }

  /** Launches an agent, waits for it to finish, and parses its result as
   * an array of PhantomBuster Instagram rows ready for the existing
   * importPhantomBusterResults() mapping. */
  async runAgentAndGetResults(
    agentId: string,
    opts: WaitForCompletionOptions & { argumentOverrides?: Record<string, unknown> } = {},
  ): Promise<PhantomBusterPost[]> {
    const { containerId } = await this.launchAgent(agentId, opts.argumentOverrides);
    const result = await this.waitForCompletion(containerId, opts);

    if (Array.isArray(result)) return result as PhantomBusterPost[];
    if (result && typeof result === "object" && Array.isArray((result as { data?: unknown }).data)) {
      return (result as { data: PhantomBusterPost[] }).data;
    }
    throw new PhantomBusterApiError(
      `PhantomBuster agent ${agentId} finished but its resultObject wasn't an array (or {data: [...]}) — got ${typeof result}. ` +
        "The exact shape depends on which Phantom this agent runs; adjust the parsing above once verified against a real run.",
      undefined,
      result,
    );
  }
}
