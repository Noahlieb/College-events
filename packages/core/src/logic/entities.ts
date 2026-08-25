import { normalizeTitle, titleSimilarity } from "./dedup.js";
import type { EntityType } from "../types/enums.js";

/**
 * Entity resolution: deciding that "The Wharf FTL", "Wharf Fort Lauderdale"
 * and "the wharf" are one venue.
 *
 * This matters because the entity graph is what lets several sources be
 * recognised as reporting the same producer's calendar. Get it wrong in one
 * direction and one venue becomes three; wrong in the other and two real
 * venues merge and their events cross-contaminate. It is deliberately
 * conservative — an over-merge is much worse than a miss, because a missed
 * link only means weaker verification, while a bad merge attaches one
 * venue's flyers to another venue's events.
 */

/** Words that carry no identifying signal in a venue/org name. */
const NOISE_WORDS = new Set([
  "the", "a", "an", "of", "at", "and",
  "inc", "llc", "ltd", "co", "corp",
  "club", "lounge", "bar", "venue", "hall",
  "official", "page", "events", "event",
]);

/** Common abbreviations that should not block a match. */
const ABBREVIATIONS: Record<string, string> = {
  ftl: "fort lauderdale",
  st: "saint",
  mt: "mount",
  univ: "university",
};

/**
 * Canonical key for an entity name. Used as the uniqueness key so a
 * repeated discovery updates one row instead of creating a near-duplicate.
 */
export function normalizeEntityName(name: string): string {
  const expanded = normalizeTitle(name)
    .split(" ")
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(" ");

  const meaningful = expanded.split(" ").filter((w) => w && !NOISE_WORDS.has(w));

  // Falling back to the un-stripped form matters for names that are
  // entirely noise words — "The Venue" is a real place, and reducing it to
  // an empty key would collapse it into every other all-noise name.
  return (meaningful.length > 0 ? meaningful : expanded.split(" ").filter(Boolean)).join(" ");
}

export interface EntityCandidate {
  id: string;
  entityType: EntityType;
  name: string;
  website?: string | null;
  instagramHandle?: string | null;
}

export interface EntityMatch {
  entity: EntityCandidate;
  score: number;
  reason: string;
}

/** Host of a URL without `www.`, or null when it isn't parseable. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

const STRONG_NAME_MATCH = 0.88;

/**
 * Best existing entity for a newly-observed name, or null to create one.
 *
 * A shared domain or Instagram handle is treated as proof — two names on
 * one official channel are the same producer, however differently they are
 * written. Name similarity alone has to clear a high bar, because venue
 * names in one city genuinely rhyme ("Revolution Live" / "Revolution Bar").
 */
export function matchEntity(
  observed: { entityType: EntityType; name: string; website?: string | null; instagramHandle?: string | null },
  existing: EntityCandidate[],
): EntityMatch | null {
  const sameType = existing.filter((e) => e.entityType === observed.entityType);
  if (sameType.length === 0) return null;

  const observedDomain = domainOf(observed.website);
  const observedHandle = observed.instagramHandle?.replace(/^@/, "").toLowerCase() ?? null;

  for (const entity of sameType) {
    if (observedDomain && domainOf(entity.website) === observedDomain) {
      return { entity, score: 1, reason: `same website domain (${observedDomain})` };
    }
    const handle = entity.instagramHandle?.replace(/^@/, "").toLowerCase() ?? null;
    if (observedHandle && handle === observedHandle) {
      return { entity, score: 1, reason: `same instagram handle (@${observedHandle})` };
    }
  }

  const observedKey = normalizeEntityName(observed.name);
  let best: EntityMatch | null = null;

  for (const entity of sameType) {
    const key = normalizeEntityName(entity.name);
    if (!observedKey || !key) continue;

    if (key === observedKey) {
      return { entity, score: 1, reason: `identical normalized name ("${key}")` };
    }
    const score = titleSimilarity(key, observedKey);
    if (score >= STRONG_NAME_MATCH && (!best || score > best.score)) {
      best = { entity, score, reason: `name similarity ${score.toFixed(2)}` };
    }
  }

  return best;
}
