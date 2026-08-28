"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, events, schools } from "@college-events/db";
// Deep import, not the @college-events/worker barrel — same reason as
// every other pipeline import in this app: the barrel re-exports
// render.ts alongside everything else, which would drag sharp into this
// Next.js app's serverless bundle. artwork.ts itself never imports
// render.ts (image *generation* has nothing to do with sharp — only
// *compositing* a slide does), so this deep import is safe without the
// render-service HTTP hop renderPostAction needs.
import { attachManualArtwork, resolveEventArtwork, selectEventArtwork } from "@college-events/worker/dist/pipeline/artwork.js";

export interface RegenerateArtworkResult {
  action: string;
  reason: string;
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // generous for a phone photo, small enough to keep the request sane
const ALLOWED_UPLOAD_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Saves the reviewer's comment and asks for a fresh AI generation of this
 * event's artwork (spec item 9). `force: true` is what makes this actually
 * regenerate rather than no-op on an unchanged fingerprint — but it does
 * NOT override the "an official flyer always wins" rule inside
 * resolveEventArtwork; if a real source image exists, the outcome comes
 * back `selected_official` and no generation happens, which the caller
 * surfaces rather than silently doing nothing.
 *
 * Only the image can change here: buildEventSlideOverlaySvg computes the
 * text layout entirely from the event's title/date/venue/price/description
 * fields, never from the image, so swapping canonicalAssetId can't move a
 * single word on the rendered slide.
 */
export async function regenerateArtworkAction(eventId: string, formData: FormData): Promise<RegenerateArtworkResult> {
  const comment = String(formData.get("comment") ?? "").trim();
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new Error("Unknown event");

  await db.update(events).set({ artworkComment: comment || null }).where(eq(events.id, eventId));

  const [school] = await db.select().from(schools).where(eq(schools.id, event.schoolId)).limit(1);
  const outcome = await resolveEventArtwork(eventId, { force: true, schoolShortName: school?.shortName });

  revalidatePath(`/events/${eventId}`);
  // A post already rendered with the old image needs its own explicit
  // "Re-render" click to pick this up — same as an event text edit — so
  // this only invalidates the events page, not every post.
  revalidatePath("/events");

  return { action: outcome.action, reason: outcome.reason };
}

/**
 * Manual "edit" path: replace an event's artwork with an admin's own file
 * instead of an AI regeneration. Stored as an official visual (same as a
 * scraped flyer — see attachManualArtwork), so it sticks against any future
 * automatic regeneration rather than being quietly overwritten on the next
 * pipeline run.
 */
export async function uploadEventArtworkAction(eventId: string, formData: FormData): Promise<RegenerateArtworkResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { action: "skipped", reason: "Choose an image file first." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { action: "skipped", reason: "Image is too large — 8MB max." };
  }
  if (!ALLOWED_UPLOAD_MIME.has(file.type)) {
    return { action: "skipped", reason: `Unsupported file type "${file.type || "unknown"}" — use JPEG, PNG, or WebP.` };
  }

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new Error("Unknown event");
  const [school] = await db.select().from(schools).where(eq(schools.id, event.schoolId)).limit(1);

  const buffer = Buffer.from(await file.arrayBuffer());
  const outcome = await attachManualArtwork(eventId, buffer, file.type, school?.shortName);

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { action: outcome.action, reason: outcome.reason };
}

/**
 * "Revert to original" (or to any other past version): points the event at
 * an existing asset from its own history — every past AI generation and
 * every uploaded/scraped flyer is already preserved as its own row (see
 * selectEventArtwork) — with no new generation and no cost.
 */
export async function selectEventArtworkAction(eventId: string, assetId: string): Promise<RegenerateArtworkResult> {
  const outcome = await selectEventArtwork(eventId, assetId);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { action: outcome.action, reason: outcome.reason };
}
