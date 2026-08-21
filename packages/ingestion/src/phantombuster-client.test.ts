import { describe, expect, it, vi } from "vitest";
import { PhantomBusterApiError, PhantomBusterClient } from "./phantombuster-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("PhantomBusterClient", () => {
  it("launches an agent and returns its containerId", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ containerId: "container-1" }));
    const client = new PhantomBusterClient({ apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.launchAgent("agent-1");
    expect(result.containerId).toBe("container-1");

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.headers).toMatchObject({ "X-Phantombuster-Key": "key" });
  });

  it("passes argumentOverrides through in the launch body", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ containerId: "container-1" }));
    const client = new PhantomBusterClient({ apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.launchAgent("agent-1", { profileUrls: ["https://instagram.com/thebreakboca"] });

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body.argument.profileUrls).toEqual(["https://instagram.com/thebreakboca"]);
  });

  it("throws when the launch response has no containerId", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = new PhantomBusterClient({ apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.launchAgent("agent-1")).rejects.toThrow(PhantomBusterApiError);
  });

  it("polls until a finished status and returns resultObject", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call < 3) return jsonResponse({ status: "running" });
      return jsonResponse({ status: "finished", resultObject: [{ username: "thebreakboca", id: "1" }] });
    });
    const client = new PhantomBusterClient({ apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.waitForCompletion("container-1", { pollIntervalMs: 1 });
    expect(result).toEqual([{ username: "thebreakboca", id: "1" }]);
    expect(call).toBe(3);
  });

  it("throws immediately on an error status instead of continuing to poll", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "error", output: "Instagram session expired" }));
    const client = new PhantomBusterClient({ apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.waitForCompletion("container-1", { pollIntervalMs: 1 })).rejects.toThrow(/error status/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("times out rather than polling forever", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "running" }));
    const client = new PhantomBusterClient({ apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      client.waitForCompletion("container-1", { pollIntervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/did not finish within/);
  });

  it("runAgentAndGetResults launches, waits, and returns the parsed post array", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = url.toString();
      if (path.includes("/agents/launch")) return jsonResponse({ containerId: "container-9" });
      call++;
      if (call < 2) return jsonResponse({ status: "running" });
      return jsonResponse({ status: "finished", resultObject: [{ username: "fauunion", id: "42" }] });
    });
    const client = new PhantomBusterClient({ apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch });

    const posts = await client.runAgentAndGetResults("agent-1", { pollIntervalMs: 1 });
    expect(posts).toEqual([{ username: "fauunion", id: "42" }]);
  });

  it("unwraps a {data: [...]} resultObject shape too", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = url.toString();
      if (path.includes("/agents/launch")) return jsonResponse({ containerId: "c1" });
      return jsonResponse({ status: "finished", resultObject: { data: [{ username: "x", id: "1" }] } });
    });
    const client = new PhantomBusterClient({ apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch });
    const posts = await client.runAgentAndGetResults("agent-1", { pollIntervalMs: 1 });
    expect(posts).toEqual([{ username: "x", id: "1" }]);
  });

  it("throws a descriptive error when resultObject isn't an array or {data:[]}", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = url.toString();
      if (path.includes("/agents/launch")) return jsonResponse({ containerId: "c1" });
      return jsonResponse({ status: "finished", resultObject: { unexpected: "shape" } });
    });
    const client = new PhantomBusterClient({ apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.runAgentAndGetResults("agent-1", { pollIntervalMs: 1 })).rejects.toThrow(/resultObject/);
  });

  it("surfaces non-2xx responses as PhantomBusterApiError with status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "invalid key" }, 401));
    const client = new PhantomBusterClient({ apiKey: "bad-key", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.launchAgent("agent-1")).rejects.toMatchObject({ status: 401 });
  });
});
