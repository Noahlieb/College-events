import { and, eq } from "drizzle-orm";
import { db, schools, sourceDiscoveryCandidates, sources } from "@college-events/db";
import {
  UniversitySourceDiscoveryService,
  createDiscoveryProvider,
  discoveryProviderConfigured,
  type DiscoveredSourceCandidate,
  type WebDiscoveryProvider,
} from "@college-events/ingestion";
import { log } from "../lib/log.js";

export interface DiscoverySummary {
  provider: string;
  configured: boolean;
  queriesRun: number;
  resultsSeen: number;
  candidatesFound: number;
  candidatesStored: number;
  candidatesUpdated: number;
  autoApprovable: number;
  categoriesWithNoResults: string[];
  /** True if a run's query loop finished without incident. False means the
   * caller's own execution was cut short — a serverless timeout, a
   * cancelled request — partway through. Whatever was found before the
   * cutoff is still saved; this just says the count above is a floor, not
   * the true total. */
  completed: boolean;
}

/**
 * Persists one candidate the moment it is found.
 *
 * Pulled out on its own because it is called from inside the discovery
 * loop via `onCandidate`, not after the loop finishes — a full run makes
 * dozens of sequential external requests and can take minutes, long
 * enough that a caller running inside a time-boxed request (a dashboard
 * button backed by a serverless function) may be cut off before
 * `discover()` ever returns its summary. Writing here means whatever was
 * found before the cutoff survives; batching the writes at the end means
 * a run killed at candidate 40 of 50 loses all 40.
 */
async function persistCandidate(
  schoolId: string,
  provider: string,
  candidate: DiscoveredSourceCandidate,
): Promise<"stored" | "updated" | "skipped"> {
  // A targeted lookup on the same (schoolId, url) pair the unique index
  // and the upsert's conflict target use — not a scan of every candidate
  // this school has ever produced.
  const [existing] = await db
    .select({ id: sourceDiscoveryCandidates.id })
    .from(sourceDiscoveryCandidates)
    .where(and(eq(sourceDiscoveryCandidates.schoolId, schoolId), eq(sourceDiscoveryCandidates.url, candidate.url)))
    .limit(1);

  const result = await db
    .insert(sourceDiscoveryCandidates)
    .values({
      schoolId,
      name: candidate.name,
      url: candidate.url,
      detectedAdapter: candidate.detectedAdapter,
      detectedEntityType: candidate.detectedEntityType,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
      discoveryMethod: candidate.discoveryMethod,
      coverageCategory: candidate.coverageCategory,
      status: "pending",
      metadata: { provider },
    })
    // Re-running refreshes a pending candidate rather than stacking
    // duplicates; a rejected one stays rejected.
    .onConflictDoUpdate({
      target: [sourceDiscoveryCandidates.schoolId, sourceDiscoveryCandidates.url],
      set: {
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        detectedAdapter: candidate.detectedAdapter,
      },
      setWhere: eq(sourceDiscoveryCandidates.status, "pending"),
    })
    .returning({ id: sourceDiscoveryCandidates.id });

  if (result.length === 0) return "skipped"; // conflict, and the row wasn't pending — left untouched on purpose
  return existing ? "updated" : "stored";
}

/**
 * Runs source discovery for one university and stores the candidates.
 *
 * Shared by the dashboard button and the CLI so the two cannot diverge —
 * "it worked from the dashboard but not the cron" is the kind of drift
 * that only shows up when someone is onboarding their fifth school. Both
 * callers get the same incremental-save behaviour for free, which is what
 * makes the dashboard button safe to click even though its host function
 * may not have minutes to spare.
 */
export async function discoverUniversitySources(
  schoolId: string,
  options: { provider?: WebDiscoveryProvider; fetchPages?: boolean; maxCandidates?: number } = {},
): Promise<DiscoverySummary> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown university ${schoolId}`);

  const provider = options.provider ?? createDiscoveryProvider();
  const known = await db
    .select({ url: sources.url, discoveryUrl: sources.discoveryUrl })
    .from(sources)
    .where(eq(sources.schoolId, schoolId));

  let stored = 0;
  let updated = 0;
  let autoApprovable = 0;

  const service = new UniversitySourceDiscoveryService(provider);
  let completed = false;
  let run: Awaited<ReturnType<typeof service.discover>>;

  try {
    run = await service.discover(
      {
        name: school.name,
        shortName: school.shortName,
        primaryDomain: school.primaryDomain,
        city: school.city,
        state: school.state,
      },
      {
        knownUrls: known.flatMap((s) => [s.url, s.discoveryUrl].filter((u): u is string => !!u)),
        fetchPages: options.fetchPages ?? true,
        maxCandidates: options.maxCandidates,
        onCandidate: async (candidate) => {
          const outcome = await persistCandidate(schoolId, provider.name, candidate);
          if (outcome === "stored") stored++;
          else if (outcome === "updated") updated++;
          if (candidate.autoApprovable) autoApprovable++;
        },
      },
    );
    completed = true;
  } catch (err) {
    // The query loop itself was interrupted (a timeout firing as an
    // AbortError, a killed connection). Everything found up to that point
    // was already written by onCandidate above — report it rather than
    // losing it by rethrowing before a summary can be built.
    const summary: DiscoverySummary = {
      provider: provider.name,
      configured: discoveryProviderConfigured(),
      queriesRun: 0,
      resultsSeen: 0,
      candidatesFound: stored + updated,
      candidatesStored: stored,
      candidatesUpdated: updated,
      autoApprovable,
      categoriesWithNoResults: [],
      completed: false,
    };
    await log(
      schoolId,
      "warn",
      "discovery",
      `Discovery run via ${provider.name} was interrupted: ${(err as Error).message}`,
      { ...summary },
    );
    return summary;
  }

  const summary: DiscoverySummary = {
    provider: run.provider,
    configured: discoveryProviderConfigured(),
    queriesRun: run.queriesRun,
    resultsSeen: run.resultsSeen,
    candidatesFound: run.candidates.length,
    candidatesStored: stored,
    candidatesUpdated: updated,
    autoApprovable,
    categoriesWithNoResults: run.categoriesWithNoResults,
    completed,
  };

  await log(schoolId, "info", "discovery", `Discovery run via ${run.provider}`, { ...summary });
  return summary;
}
