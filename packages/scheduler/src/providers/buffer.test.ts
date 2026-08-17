import { describe, expect, it } from "vitest";
import { BufferSchedulerProvider } from "./buffer.js";
import { SchedulerError } from "../types.js";

function fakeFetch(response: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

describe("BufferSchedulerProvider", () => {
  it("schedules a post and maps Buffer's response into ScheduleResult", async () => {
    const provider = new BufferSchedulerProvider({
      accessToken: "test-token",
      fetchImpl: fakeFetch({ success: true, updates: [{ id: "buf-1", status: "buffer" }] }),
    });
    const result = await provider.schedulePost({
      profileId: "fau-profile",
      imageUrls: ["https://example.com/slide1.jpg"],
      caption: "Caption",
      scheduledAt: "2026-08-24T13:00:00.000Z",
      externalRef: "post-1",
    });
    expect(result.schedulerPostId).toBe("buf-1");
    expect(result.status).toBe("scheduled");
  });

  it("throws SchedulerError when Buffer rejects the request", async () => {
    const provider = new BufferSchedulerProvider({
      accessToken: "bad-token",
      fetchImpl: fakeFetch({ success: false, message: "Invalid access token" }, false, 401),
    });
    await expect(
      provider.schedulePost({
        profileId: "fau-profile",
        imageUrls: ["https://example.com/slide1.jpg"],
        caption: "Caption",
        scheduledAt: "2026-08-24T13:00:00.000Z",
        externalRef: "post-1",
      }),
    ).rejects.toThrow(SchedulerError);
  });

  it("maps a sent update to a 'published' status", async () => {
    const provider = new BufferSchedulerProvider({
      accessToken: "test-token",
      fetchImpl: fakeFetch({ sent: true }),
    });
    const status = await provider.getPostStatus("buf-1");
    expect(status.status).toBe("published");
  });
});
