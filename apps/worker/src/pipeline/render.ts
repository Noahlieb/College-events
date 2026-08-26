import { asc, eq, inArray } from "drizzle-orm";
import { db, events, postEvents, posts, renderedAssets, schools } from "@college-events/db";
import { renderCoverSlide, renderEventSlide, type SlideBranding } from "@college-events/render";
import { assetPath, contentAddressedPath, deleteAssets, saveAsset } from "../lib/storage.js";
import { formatDateKicker, formatTimeRange, resolveVenueLabel } from "../lib/format.js";
import { mondayOfWeek, formatWeekRangeLabel } from "../lib/week.js";
import { resolveEventImage } from "./event-assets.js";
import { resolveEventArtwork } from "./artwork.js";

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

  // Merged rather than used as-is: a school added without every branding
  // field set (or none at all — the "Add University" form has no color
  // pickers) would otherwise put the literal string "undefined" into an
  // SVG fill/gradient-stop attribute, rendering as broken/invisible text
  // on every slide. A neutral fallback per-field means a school missing
  // some or all of its real colors still renders something legible.
  const DEFAULT_BRANDING: Omit<SlideBranding, "wordmark"> = {
    primaryColor: "#1A1A2E",
    secondaryColor: "#16213E",
    accentColor: "#E94560",
    backgroundColor: "#0B0B0F",
  };
  const brandingConfig = { ...DEFAULT_BRANDING, ...(school.branding as Partial<Omit<SlideBranding, "wordmark">>) };
  const branding: SlideBranding = {
    ...brandingConfig,
    wordmark: school.instagramAccount ?? `@${school.shortName.toLowerCase()}`,
  };

  // Keep the outgoing URLs so their storage objects can be cleaned up once
  // the new ones are safely written. Deleting the rows alone would orphan the
  // files; deleting the files first would blank the post if a render failed.
  const supersededUrls = (
    await db.select({ storageUrl: renderedAssets.storageUrl }).from(renderedAssets).where(eq(renderedAssets.postId, postId))
  ).map((r) => r.storageUrl);
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
  const coverPath = contentAddressedPath(assetPath(school.shortName, "posts", postId, "cover.jpg"), coverBuffer);
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
    // Chosen across every source linked to this event, not just the one
    // that happened to report it first.
    let { url: imageUrl } = await resolveEventImage(event);
    if (!imageUrl && event.assetDiscoveryStatus === "complete") {
      // Safety net: the batch artwork step normally resolves this before
      // render runs, but a post can be rendered before that step has had
      // a chance to. Going through the governed pipeline here — rather
      // than letting the slide renderer fall back to its own ungoverned
      // placeholder — is what keeps the official-beats-generated rule and
      // the generation provenance record the single source of truth for
      // every event's artwork, not just the ones a batch job reached first.
      const outcome = await resolveEventArtwork(event.id, { schoolShortName: school.shortName });
      if (outcome.action === "generated" || outcome.action === "selected_official" || outcome.action === "selected_existing_generated") {
        const refreshed = await resolveEventImage({ ...event, canonicalAssetId: outcome.assetId });
        imageUrl = refreshed.url;
      }
    }
    // Even after that, a network failure fetching the chosen image still
    // falls through to the slide renderer's own placeholder — the true
    // last resort, for when the image we selected cannot be downloaded
    // right now.
    const image = await fetchImageSafely(imageUrl);
    const slideBuffer = await renderEventSlide({
      image,
      // Multi-day events (spec item 6) get a date range on this one slide
      // rather than looking like a single-day event — formatDateKicker only
      // widens to a range when startAt/endAt actually land on different
      // calendar days in the school's timezone.
      date: formatDateKicker(event.startAt.toISOString(), school.timezone, event.endAt?.toISOString() ?? null),
      title: event.name,
      // A missing or access-gated venue ("Sign in to see location") reads as
      // a broken flyer, not a real one — resolveVenueLabel swaps it for the
      // school/city fallback instead of leaving the field blank.
      venue: resolveVenueLabel(event.venue, school.shortName, event.city ?? school.city),
      time: formatTimeRange(event.startAt.toISOString(), event.endAt?.toISOString() ?? null, school.timezone),
      price: event.price,
      description: event.description,
      category: event.category,
      branding,
    });
    const slidePath = contentAddressedPath(
      assetPath(school.shortName, "events", event.id, "rendered-v1.jpg"),
      slideBuffer,
    );
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

  // Now that every replacement is written and recorded, drop the old objects
  // -- but only those nothing references any more, asking the whole table
  // rather than just this post. Event slides live at a path keyed by event
  // ("events/<eventId>/..."), so the same object can back a slide in more
  // than one post; deciding from one post's list alone deleted a file another
  // post was still pointing at, leaving a broken image in its carousel.
  const candidates = supersededUrls.filter((u) => !assetUrls.includes(u));
  if (candidates.length > 0) {
    const stillReferenced = new Set(
      (
        await db
          .select({ storageUrl: renderedAssets.storageUrl })
          .from(renderedAssets)
          .where(inArray(renderedAssets.storageUrl, candidates))
      ).map((r) => r.storageUrl),
    );
    await deleteAssets(candidates.filter((u) => !stillReferenced.has(u)));
  }

  return { postId, slideCount: assetUrls.length, assetUrls };
}
