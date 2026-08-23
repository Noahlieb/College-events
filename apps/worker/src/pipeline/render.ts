import { asc, eq } from "drizzle-orm";
import { db, events, postEvents, posts, renderedAssets, schools } from "@college-events/db";
import { renderCoverSlide, renderEventSlide, type SlideBranding } from "@college-events/render";
import { assetPath, saveAsset } from "../lib/storage.js";
import { formatDateKicker, formatTimeRange } from "../lib/format.js";
import { mondayOfWeek, formatWeekRangeLabel } from "../lib/week.js";

/** Best-effort image fetch — a failed/slow/unreachable source photo must
 * never break rendering; the slide falls back to a category placeholder. */
async function fetchImageSafely(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export interface RenderPostResult {
  postId: string;
  slideCount: number;
  assetUrls: string[];
}

/**
 * Renders the full carousel for a post — a branded cover slide plus one
 * slide per linked event — and writes rendered_assets rows (spec §18/§19).
 * Re-running this for the same post is safe/idempotent: previous assets for
 * the post are cleared first, so approving, editing, and re-rendering never
 * accumulates stale rows.
 */
export async function renderPost(postId: string): Promise<RenderPostResult> {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) throw new Error(`Unknown post ${postId}`);
  const [school] = await db.select().from(schools).where(eq(schools.id, post.schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school for post ${postId}`);

  const brandingConfig = school.branding as Omit<SlideBranding, "wordmark">;
  const branding: SlideBranding = {
    ...brandingConfig,
    wordmark: school.instagramAccount ?? `@${school.shortName.toLowerCase()}`,
  };

  await db.delete(renderedAssets).where(eq(renderedAssets.postId, postId));

  const linkedEvents = await db
    .select({ event: events, position: postEvents.position })
    .from(postEvents)
    .innerJoin(events, eq(postEvents.eventId, events.id))
    .where(eq(postEvents.postId, postId))
    .orderBy(asc(postEvents.position));

  const assetUrls: string[] = [];

  const weekMonday = mondayOfWeek(new Date(`${post.scheduledDate}T12:00:00.000Z`));
  const coverBuffer = await renderCoverSlide({
    kicker: post.title,
    dateRange: formatWeekRangeLabel(weekMonday),
    subtitle: linkedEvents.length > 0 ? "Swipe for the full lineup →" : null,
    branding,
  });
  const coverPath = assetPath(school.shortName, "posts", postId, "cover.jpg");
  const coverUrl = await saveAsset(coverPath, coverBuffer);
  await db.insert(renderedAssets).values({
    postId,
    eventId: null,
    storageUrl: coverUrl,
    width: 1080,
    height: 1350,
    template: "cover-v1",
    metadata: { slideNumber: 1 },
  });
  assetUrls.push(coverUrl);

  for (const { event } of linkedEvents) {
    const image = await fetchImageSafely(event.sourceImage);
    const slideBuffer = await renderEventSlide({
      image,
      date: formatDateKicker(event.startAt.toISOString(), school.timezone),
      title: event.name,
      venue: event.venue,
      time: formatTimeRange(event.startAt.toISOString(), event.endAt?.toISOString() ?? null, school.timezone),
      price: event.price,
      description: event.description,
      category: event.category,
      branding,
    });
    const slidePath = assetPath(school.shortName, "events", event.id, "rendered-v1.jpg");
    const slideUrl = await saveAsset(slidePath, slideBuffer);
    await db.insert(renderedAssets).values({
      postId,
      eventId: event.id,
      storageUrl: slideUrl,
      width: 1080,
      height: 1350,
      template: "event-v1",
      metadata: { hadSourceImage: !!image },
    });
    assetUrls.push(slideUrl);
  }

  return { postId, slideCount: assetUrls.length, assetUrls };
}
