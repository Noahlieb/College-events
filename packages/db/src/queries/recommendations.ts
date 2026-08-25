import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../client.js";
import { discoveryMisses, entities, entitySources, sourceDiscoveryCandidates } from "../schema.js";
import {
  buildSourceRecommendations,
  type RecommendationInput,
  type SourceRecommendation,
} from "@college-events/core";

/**
 * Assembles a university's recommendation inputs from live tables.
 *
 * `categoryLabels` comes from the caller rather than being imported here:
 * the taxonomy of coverage categories lives in @college-events/ingestion
 * (it is discovery vocabulary), and `db` sits below `ingestion` in the
 * dependency graph — only `apps/worker` and `apps/dashboard` are allowed
 * to know about both.
 */
export async function recommendSources(
  schoolId: string,
  gaps: string[],
  categoryLabels: Record<string, string>,
  options: { since?: Date; missWindowDays?: number } = {},
): Promise<SourceRecommendation[]> {
  const since = options.since ?? new Date(Date.now() - (options.missWindowDays ?? 30) * 86_400_000);

  const [pending, missRows, unlinkedOrgs] = await Promise.all([
    db
      .select({
        id: sourceDiscoveryCandidates.id,
        name: sourceDiscoveryCandidates.name,
        coverageCategory: sourceDiscoveryCandidates.coverageCategory,
        confidence: sourceDiscoveryCandidates.confidence,
        detectedAdapter: sourceDiscoveryCandidates.detectedAdapter,
      })
      .from(sourceDiscoveryCandidates)
      .where(
        and(eq(sourceDiscoveryCandidates.schoolId, schoolId), eq(sourceDiscoveryCandidates.status, "pending")),
      ),

    db
      .select({
        domain: discoveryMisses.suspectedDomain,
        count: sql<number>`count(*)::int`,
        hasCandidate: sql<boolean>`bool_or(${discoveryMisses.hadExistingCandidate} or ${discoveryMisses.createdCandidateId} is not null)`,
        candidateId: sql<string | null>`max(${discoveryMisses.createdCandidateId}::text)`,
        sampleTitle: sql<string | null>`max(${discoveryMisses.eventTitle})`,
      })
      .from(discoveryMisses)
      .where(and(eq(discoveryMisses.schoolId, schoolId), gte(discoveryMisses.createdAt, since)))
      .groupBy(discoveryMisses.suspectedDomain),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(entities)
      .leftJoin(entitySources, eq(entities.id, entitySources.entityId))
      .where(and(eq(entities.schoolId, schoolId), eq(entities.entityType, "organization"), isNull(entitySources.sourceId))),
  ]);

  const input: RecommendationInput = {
    gaps,
    categoryLabels,
    pendingCandidates: pending,
    missOrigins: missRows.map((r) => ({
      domain: r.domain,
      count: r.count,
      hasCandidate: r.hasCandidate,
      candidateId: r.candidateId ?? undefined,
      sampleTitle: r.sampleTitle ?? undefined,
    })),
    unlinkedOrganizationCount: unlinkedOrgs[0]?.count ?? 0,
  };

  return buildSourceRecommendations(input);
}
