import { and, count, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../client.js";
import {
  assetCandidates,
  discoveryProbeRuns,
  entities,
  entitySources,
  events,
  sourceDiscoveryCandidates,
  sources,
} from "../schema.js";
import { computeCoverage, type CoverageInput, type CoverageReport } from "@college-events/core";

/**
 * Gathers the observable coverage of one university.
 *
 * Lives in the db package because both the dashboard and the worker CLI
 * need exactly these numbers, and two implementations of "how many venues
 * are we monitoring" would drift apart within a month.
 */
export async function gatherCoverage(
  schoolId: string,
  expectedCategories: string[],
  options: { since?: Date; supportedAdapterTypes?: Set<string> } = {},
): Promise<CoverageReport> {
  const since = options.since ?? new Date(Date.now() - 30 * 86_400_000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  const [sourceRows, entityRows, linkedEntityRows, eventRows, flyerRows, missCountRow, recentEventRow, generatedRows] =
    await Promise.all([
      db
        .select({ healthStatus: sources.healthStatus, active: sources.active, adapterType: sources.adapterType })
        .from(sources)
        .where(eq(sources.schoolId, schoolId)),

      db
        .select({ entityType: entities.entityType, id: entities.id })
        .from(entities)
        .where(eq(entities.schoolId, schoolId)),

      // Entities that actually have a feed, as opposed to being known to
      // exist. The gap between the two is the interesting number: an
      // organization we know about but cannot hear from contributes
      // nothing to the calendar.
      db
        .selectDistinct({ entityId: entitySources.entityId, entityType: entities.entityType })
        .from(entitySources)
        .innerJoin(entities, eq(entitySources.entityId, entities.id))
        .innerJoin(sources, eq(entitySources.sourceId, sources.id))
        .where(and(eq(entities.schoolId, schoolId), eq(sources.active, true))),

      db
        .select({ total: count() })
        .from(events)
        .where(and(eq(events.schoolId, schoolId), gte(events.createdAt, since))),

      // "Real flyer" means the chosen asset is one a source published, not
      // one we generated. An event with no canonical asset is rendering a
      // placeholder by definition.
      db
        .select({ total: count() })
        .from(events)
        .innerJoin(assetCandidates, eq(events.canonicalAssetId, assetCandidates.id))
        .where(
          and(
            eq(events.schoolId, schoolId),
            gte(events.createdAt, since),
            eq(assetCandidates.isAiGenerated, false),
          ),
        ),

      // The real measurement, summed across every probe run: how many
      // broadly-discovered events matched something a registered source
      // already reported, versus how many did not. Reading it from the
      // run log rather than counting rows in discovery_misses matters —
      // that table only ever holds the *unmatched* half, so counting its
      // rows alone would report every miss as 100% of the probe.
      db
        .select({
          matched: sql<number>`coalesce(sum(${discoveryProbeRuns.matched}), 0)::int`,
          missed: sql<number>`coalesce(sum(${discoveryProbeRuns.recordedAsMisses}), 0)::int`,
        })
        .from(discoveryProbeRuns)
        .where(eq(discoveryProbeRuns.schoolId, schoolId)),

      db
        .select({ total: count() })
        .from(events)
        .where(and(eq(events.schoolId, schoolId), gte(events.createdAt, sevenDaysAgo))),

      db
        .select({ total: count() })
        .from(events)
        .innerJoin(assetCandidates, eq(events.canonicalAssetId, assetCandidates.id))
        .where(
          and(
            eq(events.schoolId, schoolId),
            gte(events.createdAt, since),
            eq(assetCandidates.isAiGenerated, true),
          ),
        ),
    ]);

  const coveredCategories = await db
    .selectDistinct({ category: sourceDiscoveryCandidates.coverageCategory })
    .from(sourceDiscoveryCandidates)
    .where(
      and(
        eq(sourceDiscoveryCandidates.schoolId, schoolId),
        isNotNull(sourceDiscoveryCandidates.promotedSourceId),
        isNotNull(sourceDiscoveryCandidates.coverageCategory),
      ),
    );

  const activeSources = sourceRows.filter((s) => s.active);
  const linkedIds = new Set(linkedEntityRows.map((r) => r.entityId));

  // A source is "unsupported" when its platform is identified but this
  // deployment has no adapter for it — distinct from an unhealthy source,
  // whose platform we can read but is currently misbehaving.
  const supported = options.supportedAdapterTypes;
  const unsupportedCount = supported
    ? activeSources.filter((s) => s.adapterType && !supported.has(s.adapterType)).length
    : 0;

  const orgs = entityRows.filter((e) => e.entityType === "organization");
  const venues = entityRows.filter((e) => e.entityType === "venue");

  const input: CoverageInput = {
    expectedCategories,
    coveredCategories: coveredCategories.map((c) => c.category!).filter(Boolean),
    organizationsDiscovered: orgs.length,
    organizationsWithSource: orgs.filter((o) => linkedIds.has(o.id)).length,
    venuesDiscovered: venues.length,
    venuesMonitored: venues.filter((v) => linkedIds.has(v.id)).length,
    sourcesTotal: activeSources.length,
    sourcesHealthy: activeSources.filter((s) => s.healthStatus === "healthy").length,
    sourcesDegraded: activeSources.filter((s) => s.healthStatus === "degraded").length,
    sourcesFailed: activeSources.filter((s) => s.healthStatus === "failed").length,
    unsupportedPlatformsDetected: unsupportedCount,
    eventsLast7Days: recentEventRow[0]?.total ?? 0,
    eventsTotal: eventRows[0]?.total ?? 0,
    eventsWithOfficialFlyer: flyerRows[0]?.total ?? 0,
    eventsWithGeneratedArtwork: generatedRows[0]?.total ?? 0,
    // 0/0 until the probe has actually run at least once; computeCoverage
    // reports "not measured" for that case rather than a falsely clean 0%
    // miss rate.
    discoveryProbeEvents: (missCountRow[0]?.matched ?? 0) + (missCountRow[0]?.missed ?? 0),
    discoveryProbeMisses: missCountRow[0]?.missed ?? 0,
  };

  return computeCoverage(input);
}

/** Sources with their entity, for the dashboard's Active Sources table. */
export async function sourcesWithEntities(schoolId: string) {
  return db
    .select({
      source: sources,
      entityName: entities.name,
      entityType: entities.entityType,
    })
    .from(sources)
    .leftJoin(entities, eq(sources.entityId, entities.id))
    .where(eq(sources.schoolId, schoolId))
    .orderBy(sql`${sources.active} DESC, ${sources.crawlPriority} DESC`);
}

/** Pending candidates awaiting review, most confident first. */
export async function pendingCandidates(schoolId: string, limit = 50) {
  return db
    .select()
    .from(sourceDiscoveryCandidates)
    .where(
      and(
        eq(sourceDiscoveryCandidates.schoolId, schoolId),
        inArray(sourceDiscoveryCandidates.status, ["pending"]),
      ),
    )
    .orderBy(sql`${sourceDiscoveryCandidates.confidence} DESC`)
    .limit(limit);
}

/** Entities of one kind, with how many active sources each has. */
export async function entitiesWithSourceCounts(schoolId: string, entityType: "organization" | "venue" | "promoter") {
  return db
    .select({
      entity: entities,
      sourceCount: sql<number>`count(${entitySources.sourceId})::int`,
    })
    .from(entities)
    .leftJoin(entitySources, eq(entities.id, entitySources.entityId))
    .where(and(eq(entities.schoolId, schoolId), eq(entities.entityType, entityType)))
    .groupBy(entities.id)
    .orderBy(entities.name);
}
