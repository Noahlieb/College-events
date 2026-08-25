"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schools, sourceDiscoveryCandidates, sources } from "@college-events/db";
import {
  COVERAGE_CATEGORIES,
  UniversitySourceDiscoveryService,
  createDiscoveryProvider,
  fingerprintUrl,
} from "@college-events/ingestion";
import type { AdapterType } from "@college-events/core";
import { getCurrentSchool, SCHOOL_COOKIE } from "./current-school";

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
export async function discoverSourcesAction() {
  const school = await getCurrentSchool();

  const known = await db
    .select({ url: sources.url, discoveryUrl: sources.discoveryUrl })
    .from(sources)
    .where(eq(sources.schoolId, school.id));

  // Which index answers is a deployment concern, read from the
  // environment here and never sent to the browser. With nothing
  // configured this is the null provider and the run finds nothing —
  // which is a legible outcome, not a failure.
  const service = new UniversitySourceDiscoveryService(createDiscoveryProvider());
  const summary = await service.discover(
    {
      name: school.name,
      shortName: school.shortName,
      primaryDomain: school.primaryDomain,
      city: school.city,
      state: school.state,
    },
    {
      knownUrls: known.flatMap((s) => [s.url, s.discoveryUrl].filter((u): u is string => !!u)),
      // Fetch each candidate so fingerprinting sees the real page. Slower,
      // but a platform identified from markup is worth far more to a
      // reviewer than one guessed from a URL — and this runs rarely.
      fetchPages: true,
    },
  );

  for (const candidate of summary.candidates) {
    await db
      .insert(sourceDiscoveryCandidates)
      .values({
        schoolId: school.id,
        name: candidate.name,
        url: candidate.url,
        detectedAdapter: candidate.detectedAdapter,
        detectedEntityType: candidate.detectedEntityType,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        discoveryMethod: candidate.discoveryMethod,
        coverageCategory: candidate.coverageCategory,
        status: "pending",
      })
      // Re-running discovery refreshes what a candidate looks like rather
      // than stacking duplicates for a reviewer to wade through — and a
      // candidate already rejected stays rejected.
      .onConflictDoUpdate({
        target: [sourceDiscoveryCandidates.schoolId, sourceDiscoveryCandidates.url],
        set: {
          confidence: candidate.confidence,
          evidence: candidate.evidence,
          detectedAdapter: candidate.detectedAdapter,
        },
        setWhere: eq(sourceDiscoveryCandidates.status, "pending"),
      });
  }

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
