"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db, events, eventSources, postEvents, sources } from "@college-events/db";
import type { AdapterType, EventCategory, SourceCategory, SourceType } from "@college-events/core";
import { fingerprintUrl } from "@college-events/ingestion";
// Deep imports into each pipeline file rather than the @college-events/worker
// barrel (`import { x } from "@college-events/worker"`) — the barrel's
// index.ts does `export * from "./pipeline/render.js"` alongside everything
// else, and since it's evaluated as one CommonJS unit at runtime, importing
// ANYTHING through it pulls in render.js's sharp dependency too. That native
// addon isn't reliably resolvable in Vercel's deployed function output (see
// render-action.ts for the full story) and was taking down every route that
// imported from this file — including ones with nothing to do with
// rendering, like the events list and the homepage. Only renderPostAction
// actually needs sharp, and it now lives in its own file for exactly that
// reason — keep it that way rather than re-adding it here.
import { approvePost, rejectPost } from "@college-events/worker/dist/pipeline/approve.js";
import { schedulePost } from "@college-events/worker/dist/pipeline/schedule.js";
import { processSchoolRawContent } from "@college-events/worker/dist/pipeline/process.js";
import { importCsvEvents } from "@college-events/worker/dist/pipeline/csv-import.js";
import { selectWeeklyPosts } from "@college-events/worker/dist/pipeline/select-posts.js";
import { getCurrentSchool } from "./current-school";

// ── event actions ────────────────────────────────────────────────────

/**
 * Re-runs post assembly (database only — no rendering, no external HTTP
 * call) right after an event's status changes, so approving or rejecting
 * one event is immediately reflected in whichever week/lane post it
 * belongs to instead of waiting for a separate "Build this week's posts"
 * click. Selection alone is cheap (a handful of DB queries plus one small
 * AI caption call per lane); the render-service HTTP call — the actually
 * expensive part — stays a deliberate, separate action.
 *
 * Best-effort: a selection failure here must never turn a successful
 * approve/reject into a visible error. It already happened; the post just
 * won't reflect it until the next successful sync (the "Build this week's
 * posts" button, or the next approve/reject on this school).
 */
async function syncWeeklyPosts(schoolId: string): Promise<void> {
  try {
    await selectWeeklyPosts(schoolId);
  } catch {
    // See doc comment above.
  }
}

export async function approveEventAction(eventId: string) {
  const [event] = await db
    .update(events)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(events.id, eventId))
    .returning({ schoolId: events.schoolId });
  if (event) await syncWeeklyPosts(event.schoolId);
  revalidatePath("/events");
  revalidatePath("/posts");
  revalidatePath("/");
}

export async function rejectEventAction(eventId: string) {
  const [event] = await db
    .update(events)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(events.id, eventId))
    .returning({ schoolId: events.schoolId });
  if (event) {
    // A rejected event must never keep showing up in a post's slides — a
    // rebuild alone isn't enough, because a post a human already
    // approved/scheduled is deliberately locked against rebuilds (see
    // select-posts.ts). Removing it here works regardless of that post's
    // lock state; the rebuild below is what backfills the freed slot for
    // any post still open to it.
    await db.delete(postEvents).where(eq(postEvents.eventId, eventId));
    await syncWeeklyPosts(event.schoolId);
  }
  revalidatePath("/events");
  revalidatePath("/posts");
  revalidatePath("/");
}

export async function forceIncludeEventAction(eventId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return;
  const flags = Array.from(new Set([...event.flags, "force_include"]));
  await db.update(events).set({ status: "active", flags, updatedAt: new Date() }).where(eq(events.id, eventId));
  await syncWeeklyPosts(event.schoolId);
  revalidatePath("/events");
  revalidatePath("/posts");
  revalidatePath("/");
}

export async function updateEventAction(eventId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "");
  const venue = String(formData.get("venue") ?? "");
  const price = String(formData.get("price") ?? "");
  const description = String(formData.get("description") ?? "");
  const category = String(formData.get("category") ?? "other") as EventCategory;
  const postId = String(formData.get("postId") ?? "");

  await db
    .update(events)
    .set({ name, venue: venue || null, price: price || null, description: description || null, category, updatedAt: new Date() })
    .where(eq(events.id, eventId));
  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  // Post pages show this event's name and its rendered slide, so leaving them
  // cached made a saved edit look like it hadn't saved at all.
  revalidatePath("/posts", "layout");

  // Came from a post's "Edit text" button: go back there, where the change is
  // visible, instead of sitting on a form that looks untouched.
  if (postId) redirect(`/posts/${postId}`);
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
  const url = String(formData.get("url") || "") || null;
  const trustScore = Number(formData.get("trustScore") || 5);
  const crawlIntervalMinutes = Number(formData.get("crawlIntervalMinutes") || 360);

  // Adapter type can be stated explicitly, but a URL is usually enough to
  // work it out — a person adding a venue should not have to know which
  // platform it runs on.
  const declared = String(formData.get("adapterType") || "");
  const adapterType =
    declared && declared !== "generic_web"
      ? (declared as AdapterType)
      : url
        ? fingerprintUrl(url).adapterType
        : ("generic_web" as AdapterType);

  await db.insert(sources).values({
    schoolId: school.id,
    name: String(formData.get("name")),
    sourceType: String(formData.get("sourceType")) as SourceType,
    adapterType,
    category: String(formData.get("category")) as SourceCategory,
    url,
    discoveryUrl: url,
    instagramHandle: String(formData.get("instagramHandle") || "") || null,
    trustScore,
    crawlPriority: trustScore,
    // Kept in step with trustScore so any un-migrated reader of the legacy
    // column still sees a sensible value.
    priority: trustScore,
    crawlIntervalMinutes,
    scrapeFrequencyMinutes: crawlIntervalMinutes,
    // Due immediately: a source someone just added should be crawled on
    // the next tick, not after a full interval.
    nextRunAt: null,
  });
  revalidatePath("/sources");
}

export async function toggleSourceActiveAction(sourceId: string, active: boolean) {
  await db.update(sources).set({ active, updatedAt: new Date() }).where(eq(sources.id, sourceId));
  revalidatePath("/sources");
}

// ── post & pipeline actions ─────────────────────────────────────────────
// Call the worker's pipeline functions in-process rather than shelling out
// to the worker CLI, which can't spawn a subprocess on Vercel's serverless
// runtime the way local dev could. renderPostAction lives in its own file
// (render-action.ts) rather than here — see that file for why.

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
  const sourceName = String(formData.get("sourceName") || "").trim() || undefined;
  const text = await (file as File).text();

  let summary: Awaited<ReturnType<typeof importCsvEvents>>;
  try {
    summary = await importCsvEvents(school.id, text, submittedBy, sourceName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect("/import?error=" + encodeURIComponent(message.slice(0, 500)));
  }

  revalidatePath("/events");
  revalidatePath("/");
  redirect("/import?result=" + encodeURIComponent(JSON.stringify(toUrlSafeSummary(summary))));
}

/** How much of the encoded redirect URL this result is allowed to occupy.
 * Comfortably under every platform's actual limit (commonly ~8–16KB), with
 * room left for the path and the rest of the query string. */
const URL_RESULT_BUDGET_CHARS = 6000;

type CsvImportSummary = Awaited<ReturnType<typeof importCsvEvents>>;
type UrlSafeCsvImportSummary = CsvImportSummary & {
  parseErrorsTruncated: number;
  submitErrorsTruncated: number;
  routingErrorsTruncated: number;
};

/**
 * Shrinks a CSV import result until it's safe to put in a redirect URL.
 *
 * The naive version — JSON.stringify the whole thing — works for a handful
 * of errors and breaks silently for a real one: a CSV where most rows fail
 * produces dozens of error entries, event titles in the wild are full of
 * emoji, and encodeURIComponent can expand a single emoji into a dozen
 * characters. That combination blew a real UCF import past the platform's
 * URL length limit, turning "here's what went wrong on each row" into a
 * blank URI_TOO_LONG page — worse than not having the detail at all.
 *
 * Counts (created/merged/totalRows) are always exact; only the per-row
 * error *lists* shrink, in three steps: fewer entries, then shorter text
 * per entry, then — if a file is bad enough that even that doesn't fit —
 * the lists empty out entirely and only the *counts* of what went wrong
 * survive. A result is never dropped outright; it just says less.
 */
function toUrlSafeSummary(summary: CsvImportSummary): UrlSafeCsvImportSummary {
  const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

  const build = (maxEntries: number, maxCharsPerField: number): UrlSafeCsvImportSummary => ({
    ...summary,
    parseErrors: summary.parseErrors
      .slice(0, maxEntries)
      .map((e) => ({ ...e, reason: truncate(e.reason, maxCharsPerField) })),
    parseErrorsTruncated: Math.max(0, summary.parseErrors.length - maxEntries),
    submitErrors: summary.submitErrors
      .slice(0, maxEntries)
      .map((e) => ({ ...e, eventName: truncate(e.eventName, 60), reason: truncate(e.reason, maxCharsPerField) })),
    submitErrorsTruncated: Math.max(0, summary.submitErrors.length - maxEntries),
    routingErrors: summary.routingErrors
      .slice(0, maxEntries)
      .map((e) => ({ ...e, university: truncate(e.university, 60), reason: truncate(e.reason, maxCharsPerField) })),
    routingErrorsTruncated: Math.max(0, summary.routingErrors.length - maxEntries),
  });

  const fits = (candidate: UrlSafeCsvImportSummary) =>
    encodeURIComponent(JSON.stringify(candidate)).length <= URL_RESULT_BUDGET_CHARS;

  for (const [maxEntries, maxChars] of [
    [15, 150],
    [5, 100],
  ] as const) {
    const candidate = build(maxEntries, maxChars);
    if (fits(candidate)) return candidate;
  }

  // Even five short entries didn't fit — drop the lists entirely and keep
  // only the counts, which is always small.
  return { ...build(0, 0) };
}
