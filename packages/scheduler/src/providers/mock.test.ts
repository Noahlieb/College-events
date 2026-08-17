import { describe, expect, it } from "vitest";
import { MockSchedulerProvider } from "./mock.js";

describe("MockSchedulerProvider", () => {
  it("schedules a post and returns a stable id that later resolves status", async () => {
    const provider = new MockSchedulerProvider();
    const result = await provider.schedulePost({
      profileId: "fau-ig-profile",
      imageUrls: ["https://example.com/slide1.jpg", "https://example.com/slide2.jpg"],
      caption: "THIS WEEK AT FAU\n\nSave this post!",
      scheduledAt: "2026-08-24T13:00:00.000Z",
      externalRef: "post-123",
    });
    expect(result.status).toBe("scheduled");
    expect(result.schedulerPostId).toContain("post-123");

    const status = await provider.getPostStatus(result.schedulerPostId);
    expect(status.status).toBe("scheduled");
  });

  it("returns 'unknown' status for an id it has never seen", async () => {
    const provider = new MockSchedulerProvider();
    const status = await provider.getPostStatus("nonexistent");
    expect(status.status).toBe("unknown");
  });

  it("removes a post on cancel", async () => {
    const provider = new MockSchedulerProvider();
    const result = await provider.schedulePost({
      profileId: "fau-ig-profile",
      imageUrls: ["https://example.com/slide1.jpg"],
      caption: "test",
      scheduledAt: "2026-08-24T13:00:00.000Z",
      externalRef: "post-456",
    });
    await provider.cancelPost(result.schedulerPostId);
    const status = await provider.getPostStatus(result.schedulerPostId);
    expect(status.status).toBe("unknown");
  });
});
