"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db, events, eventSources, sources } from "@college-events/db";
import type { EventCategory, SourceCategory, SourceType } from "@college-events/core";
import { getCurrentSchool } from "./current-school";
import { runWorkerCommand } from "./run-worker-command";

// ── event actions ─────────────────────────────────────────

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

// ── source actions ───────────────────────────────────

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

// ── post & pipeline actions ─────────────────────────────
// These shell out to the worker CLI (see lib/run-worker-command.ts) rather
// than importing the pipeline in-process: rendering pulls in sharp (a
// native addon) which fights Next's server bundler, and it's the correct
// architectural boundary anyway — the dashboard triggers jobs, the worker
// process executes them, same as an n8n-triggered run would.

export async function approvePostAction(postId: string) {
  await runWorkerCommand("approve", postId, "dashboard-admin");
  revalidatePath("/posts");
  revalidatePath(`/posts/${postId}`);
}

export async function rejectPostAction(postId: string, formData: FormData) {
  const reason = String(formData.get("reason") ?? "") || "rejected from dashboard";
  await runWorkerCommand("reject", postId, reason, "dashboard-admin");
  revalidatePath("/posts");
  revalidatePath(`/posts/${postId}`);
}

export async function renderPostAction(postId: string) {
  await runWorkerCommand("render", postId);
  revalidatePath(`/posts/${postId}`);
}

export async function schedulePostAction(postId: string) {
  await runWorkerCommand("schedule", postId);
  revalidatePath("/posts");
  revalidatePath(`/posts/${postId}`);
}

export async function runProcessAction() {
  const school = await getCurrentSchool();
  await runWorkerCommand("process", school.shortName);
  revalidatePath("/");
  revalidatePath("/events");
}

export async function runSelectPostsAction() {
  const school = await getCurrentSchool();
  await runWorkerCommand("select-posts", school.shortName);
  revalidatePath("/posts");
}
