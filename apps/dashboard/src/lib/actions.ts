"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db, events, eventSources, sources } from "@college-events/db";
import type { EventCategory, SourceCategory, SourceType } from "@college-events/core";
import {
  approvePost,
  rejectPost,
  renderPost,
  schedulePost,
  processSchoolRawContent,
  selectWeeklyPosts,
  importCsvEvents,
} from "@college-events/worker";
import { getCurrentSchool } from "./current-school";

// ── event actions ────────────────────────────────────────────────────

export async function approveEventAction(eventId: string) {
  await db.update(events).set({ status: "active", updatedAt: new Date() }).where(eq(events.id, eventId));
  revalidatePath("/events");
}

export async function rejectEventAction(eventId: string) {
  await db.update(events).set({ status: "rejected", updatedAt: new Date() }).where(eq(events.id, eventId));
  revalidatePath("/events");
}

export async function forceIncludeEventAction(eventId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return;
  const flags = Array.from(new Set([...event.flags, "force_include"]));
  await db.update(events).set({ status: "active", flags, updatedAt: new Date() }).where(eq(events.id, eventId));
  revalidatePath("/events");
}

export async function updateEventAction(eventId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "");
  const venue = String(formData.get("venue") ?? "");
  const price = String(formData.get("price") ?? "");
  const description = String(formData.get("description") ?? "");
  const category = String(formData.get("category") ?? "other") as EventCategory;

  await db
    .update(events)
    .set({ name, venue: venue || null, price: price || null, description: description || null, category, updatedAt: new Date() })
    .where(eq(events.id, eventId));
  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
}

/** Merges a duplicate event into a primary one: re-points its raw source
 * links and marks it REJECTED rather than deleting it, so raw_content and
 * event history stay intact (spec §15 "never delete the underlying raw
 * records" — the same principle extends to keeping the merged event row
 * as an auditable trace instead of a hard delete). */
export async function mergeEventsAction(primaryEventId: string, formData: FormData) {
  const duplicateEventId = String(formData.get("duplicateEventId") ?? "");
  if (!duplicateEventId || primaryEventId === duplicateEventId) return;
  await db.update(eventSources).set({ eventId: primaryEventId }).where(eq(eventSources.eventId, duplicateEventId));
  await db
    .update(events)
    .set({ status: "rejected", flags: sql`flags || ${JSON.stringify([`merged_into:${primaryEventId}`])}::jsonb`, updatedAt: new Date() })
    .where(eq(events.id, duplicateEventId));
  revalidatePath("/events");
}

// ── source actions ───────────────────────────────────────────────────

export async function addSourceAction(formData: FormData) {
  const school = await getCurrentSchool();
  await db.insert(sources).values({
    schoolId: school.id,
    name: String(formData.get("name")),
    sourceType: String(formData.get("sourceType")) as SourceType,
    category: String(formData.get("category")) as SourceCategory,
    url: String(formData.get("url") || "") || null,
    instagramHandle: String(formData.get("instagramHandle") || "") || null,
    priority: Number(formData.get("priority") || 5),
    scrapeFrequencyMinutes: Number(formData.get("scrapeFrequencyMinutes") || 360),
  });
  revalidatePath("/sources");
}

export async function toggleSourceActiveAction(sourceId: string, active: boolean) {
  await db.update(sources).set({ active, updatedAt: new Date() }).where(eq(sources.id, sourceId));
  revalidatePath("/sources");
}

// ── post & pipeline actions ─────────────────────────────────────────────
// Call the worker's pipeline functions in-process rather than shelling out
// to the worker CLI. sharp (pulled in via renderPost) is kept out of
// Next's webpack bundle via serverExternalPackages in next.config.js —
// see that file for why — so this works on Vercel's serverless runtime,
// which can't spawn a pnpm subprocess the way local dev could.

export async function approvePostAction(postId: string) {
  await approvePost(postId, "dashboard-admin");
  revalidatePath("/posts");
  revalidatePath(`/posts/${postId}`);
}

export async function rejectPostAction(postId: string, formData: FormData) {
  const reason = String(formData.get("reason") ?? "") || "rejected from dashboard";
  await rejectPost(postId, reason, "dashboard-admin");
  revalidatePath("/posts");
  revalidatePath(`/posts/${postId}`);
}

export async function renderPostAction(postId: string) {
  await renderPost(postId);
  revalidatePath(`/posts/${postId}`);
}

export async function schedulePostAction(postId: string) {
  await schedulePost(postId);
  revalidatePath("/posts");
  revalidatePath(`/posts/${postId}`);
}

export async function runProcessAction() {
  const school = await getCurrentSchool();
  await processSchoolRawContent(school.id);
  revalidatePath("/");
  revalidatePath("/events");
}

export async function runSelectPostsAction() {
  const school = await getCurrentSchool();
  await selectWeeklyPosts(school.id);
  revalidatePath("/posts");
}

// ── CSV import ───────────────────────────────────────────────────────
// A CSV of already-structured events (Date, Time, Category, Event,
// Presenter/Team, Venue, Notes, Image URL, Link) is bulk-submitted through
// the same submitManualEvent() path a single manual entry uses — see
// apps/worker/src/pipeline/csv-import.ts. Called in-process directly on
// the uploaded text — no temp file needed now that this doesn't go through
// a CLI, which is the one part that actually got simpler from this refactor.
export async function importCsvAction(formData: FormData) {
  const school = await getCurrentSchool();
  const file = formData.get("csvFile");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/import?error=" + encodeURIComponent("Choose a CSV file first."));
  }
  const submittedBy = String(formData.get("submittedBy") || "dashboard-upload").trim() || "dashboard-upload";
  const text = await (file as File).text();

  let summary: Awaited<ReturnType<typeof importCsvEvents>>;
  try {
    summary = await importCsvEvents(school.id, text, submittedBy);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect("/import?error=" + encodeURIComponent(message.slice(0, 500)));
  }

  revalidatePath("/events");
  revalidatePath("/");
  redirect("/import?result=" + encodeURIComponent(JSON.stringify(summary)));
}
