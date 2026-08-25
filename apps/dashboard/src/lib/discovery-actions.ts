"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schools, sourceDiscoveryCandidates, sources } from "@college-events/db";
import { COVERAGE_CATEGORIES, fingerprintUrl } from "@college-events/ingestion";
import type { AdapterType } from "@college-events/core";
import { getCurrentSchool, SCHOOL_COOKIE } from "./current-school";
// Deep import, not the @college-events/worker barrel — see the comment on
// the equivalent imports in actions.ts. The barrel's index.ts re-exports
// render.ts alongside everything else, and since it's evaluated as one
// CommonJS unit at runtime, importing anything through it pulls in
// render.ts's sharp dependency too — a native binary Next.js cannot
// bundle into a serverless function.
import { discoverUniversitySources } from "@college-events/worker/dist/pipeline/discover.js";

/** Switch which university the dashboard is showing. */
export async function selectUniversityAction(formData: FormData) {
  const id = String(formData.get("schoolId") ?? "");
  if (!id) return;
  const store = await cookies();
  store.set(SCHOOL_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

/**
 * Onboards a university.
 *
 * Everything the rest of the system needs to work on a new school is on
 * this one form — which is the actual claim the refactor is making. No
 * adapter, migration or scraper is written to add one.
 */
export async function addUniversityAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const shortName = String(formData.get("shortName") ?? "").trim();
  if (!name || !shortName) return;

  // Stored bare so `site:` queries build correctly; people paste full URLs.
  const primaryDomain =
    String(formData.get("primaryDomain") ?? "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "") || null;

  const [school] = await db
    .insert(schools)
    .values({
      name,
      shortName,
      primaryDomain,
      city: String(formData.get("city") ?? "").trim(),
      state: String(formData.get("state") ?? "").trim(),
      country: String(formData.get("country") || "US"),
      latitude: Number(formData.get("latitude") || 0),
      longitude: Number(formData.get("longitude") || 0),
      timezone: String(formData.get("timezone") || "America/New_York"),
      nightlifeRadiusMiles: Number(formData.get("nightlifeRadiusMiles") || 25),
      instagramAccount: String(formData.get("instagramAccount") || "") || null,
    })
    .returning();

  if (school) {
    const store = await cookies();
    store.set(SCHOOL_COOKIE, school.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  revalidatePath("/", "layout");
  revalidatePath("/sources");
}

/**
 * Runs source discovery for the current university and records candidates.
 *
 * With no search provider configured this finds nothing and says so, which
 * is the correct behaviour — discovery is a safety net over a registry
 * that already works, and no paid provider is wired in by default.
 */
/**
 * Runs discovery for the currently-selected university via the shared
 * `discoverUniversitySources` pipeline function — the exact same code path
 * `pnpm worker discover <school>` uses, so the two can never drift apart.
 *
 * That sharing is also what makes this safe to call from a serverless
 * function with a hard time limit: candidates are persisted the moment
 * each is found (see `onCandidate` in the discovery service), not batched
 * until the whole run finishes. A request that gets cut off partway
 * through — a platform timeout, a dropped connection — still keeps
 * everything found up to that point instead of losing the whole run.
 */
export async function discoverSourcesAction(): Promise<void> {
  const school = await getCurrentSchool();
  await discoverUniversitySources(school.id, { fetchPages: true });
  revalidatePath("/sources");
}

/** Adds a URL by hand as a candidate, fingerprinted like any other. */
export async function addCandidateUrlAction(formData: FormData) {
  const school = await getCurrentSchool();
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return;

  const fingerprint = fingerprintUrl(url);
  await db
    .insert(sourceDiscoveryCandidates)
    .values({
      schoolId: school.id,
      name: String(formData.get("name") || "") || url,
      url,
      detectedAdapter: fingerprint.adapterType,
      confidence: fingerprint.confidence,
      evidence: fingerprint.evidence,
      discoveryMethod: "manual",
      coverageCategory: String(formData.get("coverageCategory") || "") || null,
      status: "pending",
    })
    .onConflictDoNothing();
  revalidatePath("/sources");
}

/**
 * Promotes a candidate to a real source.
 *
 * The candidate is kept and marked approved rather than deleted, so the
 * same URL is never re-proposed and there is a record of who accepted what.
 */
export async function approveCandidateAction(candidateId: string) {
  const [candidate] = await db
    .select()
    .from(sourceDiscoveryCandidates)
    .where(eq(sourceDiscoveryCandidates.id, candidateId))
    .limit(1);
  if (!candidate || candidate.status !== "pending") return;

  const category = COVERAGE_CATEGORIES.find((c) => c.key === candidate.coverageCategory);
  const isNearby = category ? !category.firstParty : false;

  const [source] = await db
    .insert(sources)
    .values({
      schoolId: candidate.schoolId,
      name: candidate.name,
      // source_type stays descriptive; adapter_type is what the crawler
      // dispatches on.
      sourceType: isNearby ? "venue_website" : "university_calendar",
      adapterType: (candidate.detectedAdapter ?? "generic_web") as AdapterType,
      category: isNearby ? "nearby" : "campus",
      url: candidate.url,
      discoveryUrl: candidate.url,
      entityType: candidate.detectedEntityType,
      // A newly approved source starts mid-trust: it has been reviewed,
      // but nothing it says has been corroborated yet.
      trustScore: 5,
      crawlPriority: 5,
      active: true,
      // No next_run_at means "due immediately", so an approved source is
      // crawled on the next tick rather than after a full interval.
      nextRunAt: null,
    })
    .returning();

  await db
    .update(sourceDiscoveryCandidates)
    .set({ status: "approved", promotedSourceId: source?.id ?? null, reviewedAt: new Date() })
    .where(eq(sourceDiscoveryCandidates.id, candidateId));

  revalidatePath("/sources");
}

export async function rejectCandidateAction(candidateId: string, formData?: FormData) {
  await db
    .update(sourceDiscoveryCandidates)
    .set({
      status: "rejected",
      reviewedAt: new Date(),
      rejectedReason: formData ? String(formData.get("reason") || "") || null : null,
    })
    .where(eq(sourceDiscoveryCandidates.id, candidateId));
  revalidatePath("/sources");
}

/** Marks a source due now, so the next scheduler tick picks it up. */
export async function runSourceNowAction(sourceId: string) {
  await db.update(sources).set({ nextRunAt: null }).where(eq(sources.id, sourceId));
  revalidatePath("/sources");
}
