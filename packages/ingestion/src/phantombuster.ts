import type { DiscoveredItem } from "./types.js";

/**
 * Shape of a single row in PhantomBuster's Instagram scraper output. Field
 * names vary slightly across PhantomBuster's different Instagram agents, so
 * this accepts the common aliases rather than locking to one agent's exact
 * schema (spec §8).
 */
export interface PhantomBusterPost {
  username?: string;
  profileUsername?: string;
  ownerUsername?: string;
  id?: string;
  postId?: string;
  shortCode?: string;
  postUrl?: string;
  url?: string;
  caption?: string;
  description?: string;
  timestamp?: string;
  publishedAt?: string;
  imgUrl?: string;
  videoUrl?: string;
  mediaUrl?: string;
  type?: string; // "Image" | "Video" | "Carousel"
}

export interface PhantomBusterImportResult {
  items: DiscoveredItem[];
  skipped: number;
}

/**
 * Converts raw PhantomBuster Instagram scraper JSON into DiscoveredItems.
 * PhantomBuster is purely the collection mechanism — all intelligence
 * (is this an event? what event?) happens downstream in the AI pipeline.
 * Caps to the newest `maxItems` posts per account since we only care
 * whether an account posted something new since the last scan (spec §8).
 */
export function importPhantomBusterPosts(
  posts: PhantomBusterPost[],
  options: { maxItemsPerAccount?: number } = {},
): PhantomBusterImportResult {
  const maxItems = options.maxItemsPerAccount ?? 5;

  const byAccount = new Map<string, PhantomBusterPost[]>();
  let skipped = 0;
  for (const post of posts) {
    const username = post.username ?? post.profileUsername ?? post.ownerUsername;
    const postId = post.id ?? post.postId ?? post.shortCode;
    if (!username || !postId) {
      skipped++;
      continue;
    }
    const list = byAccount.get(username) ?? [];
    list.push(post);
    byAccount.set(username, list);
  }

  const items: DiscoveredItem[] = [];
  for (const [username, accountPosts] of byAccount) {
    const sorted = [...accountPosts].sort((a, b) => {
      const ta = new Date(a.timestamp ?? a.publishedAt ?? 0).getTime();
      const tb = new Date(b.timestamp ?? b.publishedAt ?? 0).getTime();
      return tb - ta;
    });
    for (const post of sorted.slice(0, maxItems)) {
      const postId = post.id ?? post.postId ?? post.shortCode!;
      const mediaUrl = post.imgUrl ?? post.videoUrl ?? post.mediaUrl ?? null;
      const publishedAt = parseTimestamp(post.timestamp ?? post.publishedAt);
      items.push({
        externalId: `ig:${username}:${postId}`,
        sourceUrl: post.postUrl ?? post.url ?? null,
        rawText: post.caption ?? post.description ?? null,
        mediaUrl,
        publishedAt,
        rawMetadata: { username, mediaType: post.type ?? null },
      });
    }
  }
  return { items, skipped };
}

function parseTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
