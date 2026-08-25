import { and, eq, or, isNull } from "drizzle-orm";
import { db, events, schools } from "@college-events/db";
import { createArtworkGenerator, type EventArtworkGenerator } from "@college-events/ai";
import { resolveEventArtwork, type ArtworkOutcome } from "./artwork.js";

export interface ResolveArtworkSummary {
  inspected: number;
  selectedOfficial: number;
  generated: number;
  alreadyGenerated: number;
  skipped: number;
  outcomes: { eventId: string; outcome: ArtworkOutcome }[];
}

/**
 * Batch entry point: brings every event that needs an artwork decision to
 * a resolved state.
 *
 * Scoped to events whose asset discovery finished but which have no
 * canonical asset yet, or whose last generation attempt failed. Everything
 * else was already decided — by `recordObservationImage`'s re-selection on
 * every new observation, generation is not the only way an event's
 * artwork changes, so this job does not need to revisit events that
 * already have one. Re-scanning a whole school's history on every run
 * would not scale past a handful of universities.
 *
 * Kept separate from `process.ts` deliberately: generation can call a paid
 * model, and putting it on the ingestion hot path would make processing
 * one raw_content row as slow as the slowest image call. Running it as its
 * own batch step is what makes the concurrency and cost boundable.
 */
export async function resolveArtworkForSchool(
  schoolId: string,
  options: { generator?: EventArtworkGenerator | null; limit?: number } = {},
): Promise<ResolveArtworkSummary> {
  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error(`Unknown school ${schoolId}`);

  const pending = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.schoolId, schoolId),
        eq(events.assetDiscoveryStatus, "complete"),
        or(isNull(events.canonicalAssetId), eq(events.generationStatus, "failed")),
      ),
    )
    .limit(options.limit ?? 200);

  const generator = options.generator ?? createArtworkGenerator();
  const summary: ResolveArtworkSummary = {
    inspected: 0,
    selectedOfficial: 0,
    generated: 0,
    alreadyGenerated: 0,
    skipped: 0,
    outcomes: [],
  };

  for (const { id } of pending) {
    summary.inspected++;
    const outcome = await resolveEventArtwork(id, { generator, schoolShortName: school.shortName });
    summary.outcomes.push({ eventId: id, outcome });
    if (outcome.action === "selected_official") summary.selectedOfficial++;
    else if (outcome.action === "generated") summary.generated++;
    else if (outcome.action === "selected_existing_generated") summary.alreadyGenerated++;
    else summary.skipped++;
  }

  return summary;
}
