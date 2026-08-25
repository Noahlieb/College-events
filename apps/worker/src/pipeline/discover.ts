import { eq } from "drizzle-orm";
import { db, schools, sourceDiscoveryCandidates, sources } from "@college-events/db";
import {
  UniversitySourceDiscoveryService,
  createDiscoveryProvider,
  discoveryProviderConfigured,
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
}

/**
 * Runs source discovery for one university and stores the candidates.
 *
 * Shared by the dashboard button and the CLI so the two cannot diverge —
 * "it worked from the dashboard but not the cron" is the kind of drift
 * that only shows up when someone is onboarding their fifth school.
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

  const service = new UniversitySourceDiscoveryService(provider);
  const run = await service.discover(
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
    },
  );

  let stored = 0;
  let updated = 0;
  for (const candidate of run.candidates) {
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
        metadata: { provider: run.provider },
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
      .returning({ id: sourceDiscoveryCandidates.id, createdAt: sourceDiscoveryCandidates.createdAt });

    if (result.length === 0) continue;
    // A row whose createdAt is within this run is new; anything older was
    // an update to an existing pending candidate.
    const age = Date.now() - (result[0]!.createdAt?.getTime() ?? Date.now());
    if (age < 5000) stored++;
    else updated++;
  }

  const summary: DiscoverySummary = {
    provider: run.provider,
    configured: discoveryProviderConfigured(),
    queriesRun: run.queriesRun,
    resultsSeen: run.resultsSeen,
    candidatesFound: run.candidates.length,
    candidatesStored: stored,
    candidatesUpdated: updated,
    autoApprovable: run.candidates.filter((c) => c.autoApprovable).length,
    categoriesWithNoResults: run.categoriesWithNoResults,
  };

  await log(schoolId, "info", "discovery", `Discovery run via ${run.provider}`, { ...summary });
  return summary;
}
