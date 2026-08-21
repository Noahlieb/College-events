import { describe, expect, it } from "vitest";
import { importPhantomBusterPosts } from "./phantombuster.js";

describe("importPhantomBusterPosts", () => {
  it("groups by account and caps to the newest N posts per account", () => {
    const posts = Array.from({ length: 8 }, (_, i) => ({
      username: "thebreakboca",
      id: `post-${i}`,
      caption: `Post ${i}`,
      timestamp: new Date(2026, 7, i + 1).toISOString(),
      postUrl: `https://instagram.com/p/post-${i}`,
      imgUrl: `https://example.com/media/${i}.jpg`,
    }));
    const { items } = importPhantomBusterPosts(posts, { maxItemsPerAccount: 3 });
    expect(items).toHaveLength(3);
    // newest first
    expect(items[0]!.externalId).toBe("ig:thebreakboca:post-7");
  });

  it("skips malformed rows missing a username or post id", () => {
    const { items, skipped } = importPhantomBusterPosts([
      { username: "ok", id: "1", caption: "fine" },
      { caption: "no username or id" },
    ]);
    expect(items).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("produces a stable externalId usable as the raw_content dedup key", () => {
    const { items } = importPhantomBusterPosts([{ username: "fauunion", id: "abc123", caption: "hi" }]);
    expect(items[0]!.externalId).toBe("ig:fauunion:abc123");
  });
});
