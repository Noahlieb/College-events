import { and, eq, gte } from "drizzle-orm";
import {
  db,
  discoveryMisses,
  discoveryProbeRuns,
  events,
  schools,
  sourceDiscoveryCandidates,
} from "@college-events/db";
import {
  buildDiscoveryMissProbeQueries,
  createDiscoveryProvider,
  discoveryProviderConfigured,
  isPlausibleSourceUrl,
  type WebDiscoveryProvider,
} from "@college-events/ingestion";
import { findEventMatch, guessDateFromText, type KnownEvent } from "@college-events/core";
import { log } from "../lib/log.js";

/**
 * The discovery miss probe: a second, independent look at "what's actually
 * happening", checked against what the registered source graph already
 * caught.
 *
 * This is the measurement the earlier coverage work described but never
 * implemented — it counted candidates from ordinary source discovery,
 * which asks "where are the venues", not "what events are actually
 * happening that we missed". Those are different questions, and only the
 * second one can find a producer nobody thought to search for.
 *
 * Deliberately run as its own occasional job rather than on the daily
 * schedule: it spends search quota on queries that mostly confirm what the
 * registry already knows, which is useful evidence but not something that
 * needs checking every morning.
 */

export interface DiscoveryMissProbeSummary {
  provider: string;
  configured: boolean;
  queriesRun: number;
  resultsSeen: number;
  matched: number;
  recorded: number;
  alreadyKnown: number;
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function runDiscoveryMissProbe(
  schoolId: string,
  options: { provider?: WebDiscoveryProvider; lookaheadDays?: number; now?: Date } = {},
): Promise<DiscoveryMissProbeSummary> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown university ${schoolId}`);

  const provider = options.provider ?? createDiscoveryProvider();
  const now = options.now ?? new Date();
  const lookaheadDays = options.lookaheadDays ?? 14;
  const horizon = new Date(now.getTime() + lookaheadDays * 86_400_000);

  // Only near-future, currently-tracked events are a fair comparison set —
  // the probe is checking "did we catch what's coming up", not auditing
  // history.
  const [knownEvents, existingCandidates] = await Promise.all([
    db
      .select({ id: events.id, name: events.name, startAt: events.startAt })
      .from(events)
      .where(and(eq(events.schoolId, schoolId), gte(events.startAt, now))),
    db
      .select({ url: sourceDiscoveryCandidates.url })
      .from(sourceDiscoveryCandidates)
      .where(eq(sourceDiscoveryCandidates.schoolId, schoolId)),
  ]);

  const known: KnownEvent[] = knownEvents
    .filter((e) => e.startAt <= horizon)
    .map((e) => ({ id: e.id, name: e.name, startAt: e.startAt.toISOString() }));

  const knownDomains = new Set(
    existingCandidates.map((c) => domainOf(c.url)).filter((d): d is string => d !== null),
  );

  const queries = buildDiscoveryMissProbeQueries({
    name: school.name,
    shortName: school.shortName,
    primaryDomain: school.primaryDomain,
    city: school.city,
    state: school.state,
  });

  const summary: DiscoveryMissProbeSummary = {
    provider: provider.name,
    configured: discoveryProviderConfigured(),
    queriesRun: queries.length,
    resultsSeen: 0,
    matched: 0,
    recorded: 0,
    alreadyKnown: 0,
  };

  for (const query of queries) {
    let results;
    try {
      results = await provider.search(query);
    } catch {
      continue; // one bad query says nothing about the rest
    }
    summary.resultsSeen += results.length;

    for (const result of results) {
      if (!isPlausibleSourceUrl(result.url)) continue;
      const domain = domainOf(result.url);
      if (!domain) continue;

      const match = findEventMatch({ title: result.title, url: result.url, snippet: result.snippet }, known, now);
      if (match) {
        summary.matched++;
        continue;
      }

      const inserted = await db
        .insert(discoveryMisses)
        .values({
          schoolId,
          discoveredUrl: result.url,
          eventTitle: result.title || result.url,
          eventDateGuess: guessDateFromText(`${result.title} ${result.snippet ?? ""}`, now),
          referringProvider: provider.name,
          suspectedDomain: domain,
          hadExistingCandidate: knownDomains.has(domain),
        })
        .onConflictDoNothing({ target: [discoveryMisses.schoolId, discoveryMisses.discoveredUrl] })
        .returning({ id: discoveryMisses.id });

      if (inserted.length > 0) summary.recorded++;
      else summary.alreadyKnown++;
    }
  }

  await db.insert(discoveryProbeRuns).values({
    schoolId,
    provider: provider.name,
    queriesRun: summary.queriesRun,
    resultsSeen: summary.resultsSeen,
    matched: summary.matched,
    recordedAsMisses: summary.recorded,
    runAt: now,
  });

  await recommendFromRepeatedMisses(schoolId);
  await log(schoolId, "info", "discovery-miss", `Discovery miss probe via ${provider.name}`, { ...summary });
  return summary;
}

const MISS_RECOMMENDATION_THRESHOLD = 3;

/**
 * Turns a domain with repeated, still-uncandidated misses into a review
 * candidate.
 *
 * Never creates a source directly — only ever a `pending`
 * source_discovery_candidate, which still needs a human's approval before
 * anything is crawled. Confidence is capped below auto-approval: three
 * misses is a real pattern, but a pattern in loosely-matched search
 * results is not the same evidence as a fingerprinted platform page, and
 * it must not be treated as if it were.
 */
export async function recommendFromRepeatedMisses(schoolId: string): Promise<number> {
  const misses = await db
    .select()
    .from(discoveryMisses)
    .where(and(eq(discoveryMisses.schoolId, schoolId)));

  const byDomain = new Map<string, typeof misses>();
  for (const miss of misses) {
    if (miss.hadExistingCandidate || miss.createdCandidateId) continue;
    const list = byDomain.get(miss.suspectedDomain) ?? [];
    list.push(miss);
    byDomain.set(miss.suspectedDomain, list);
  }

  let created = 0;
  for (const [domain, list] of byDomain) {
    if (list.length < MISS_RECOMMENDATION_THRESHOLD) continue;

    const sample = list[0]!;
    const [candidate] = await db
      .insert(sourceDiscoveryCandidates)
      .values({
        schoolId,
        name: guessNameFromTitle(sample.eventTitle) ?? domain,
        url: `https://${domain}`,
        detectedAdapter: "generic_web",
        detectedEntityType: "venue",
        // Below AUTO_APPROVE_CONFIDENCE deliberately — see doc comment.
        confidence: Math.min(0.7, 0.4 + list.length * 0.05),
        evidence: [
          `produced ${list.length} discovery misses`,
          ...list.slice(0, 3).map((m) => `"${m.eventTitle}" (${m.discoveredUrl})`),
        ],
        discoveryMethod: "discovery_miss",
        status: "pending",
      })
      .onConflictDoUpdate({
        target: [sourceDiscoveryCandidates.schoolId, sourceDiscoveryCandidates.url],
        set: { evidence: [`produced ${list.length} discovery misses`] },
        setWhere: eq(sourceDiscoveryCandidates.status, "pending"),
      })
      .returning({ id: sourceDiscoveryCandidates.id });

    if (candidate) {
      created++;
      await db
        .update(discoveryMisses)
        .set({ createdCandidateId: candidate.id })
        .where(and(eq(discoveryMisses.schoolId, schoolId), eq(discoveryMisses.suspectedDomain, domain)));
    }
  }
  return created;
}

function guessNameFromTitle(title: string): string | null {
  const at = /(?:@|at)\s+([A-Z][\w' -]{2,40})$/.exec(title);
  return at ? at[1]!.trim() : null;
}
