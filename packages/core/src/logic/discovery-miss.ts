import { titleSimilarity } from "./dedup.js";

/**
 * Matching a broadly-discovered event against what the registered source
 * graph already knows.
 *
 * Search results give a title, a URL, and sometimes a snippet — never a
 * clean structured date, a venue, or an organizer. That is much thinner
 * than the fields `dedup.ts` compares for merging two ingested events, so
 * this is a deliberately looser, separate check: it is asking "does this
 * look like something we already have", not "are these definitely the
 * same event" — the latter is what governs merging real event rows, and
 * conflating the two would either merge on too little evidence or call
 * everything a miss because dates never quite line up.
 */

export interface DiscoveryMissCandidate {
  title: string;
  url: string;
  snippet?: string | null;
}

export interface KnownEvent {
  id: string;
  name: string;
  startAt: string; // ISO
}

/** How close two match scores can be before neither is a confident best. */
const MATCH_THRESHOLD = 0.55;

/**
 * Best-guess date extraction from a search snippet.
 *
 * Deliberately narrow — "Sat, Sep 5" / "September 5" / "9/5" — because a
 * wrong guess is worse than no guess: it would silently exclude an event
 * that is really unmatched from the comparison window, undercounting
 * misses instead of finding them. `referenceYear` resolves a bare
 * month/day into the right year without assuming "this year" when the
 * event is early January and being discovered in December.
 */
export function guessDateFromText(text: string, referenceDate: Date = new Date()): Date | null {
  const months =
    "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const monthIndex: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const named = new RegExp(`\\b(${months})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i").exec(text);
  if (named) {
    const key = named[1]!.slice(0, 3).toLowerCase();
    const day = Number(named[2]);
    const month = monthIndex[key];
    if (month != null && day >= 1 && day <= 31) {
      const year = resolveYear(month, referenceDate);
      return new Date(Date.UTC(year, month, day, 12));
    }
  }

  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (numeric) {
    const month = Number(numeric[1]) - 1;
    const day = Number(numeric[2]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const year = numeric[3]
        ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]))
        : resolveYear(month, referenceDate);
      return new Date(Date.UTC(year, month, day, 12));
    }
  }

  return null;
}

function resolveYear(month: number, referenceDate: Date): number {
  const year = referenceDate.getUTCFullYear();
  // A month earlier than the current one is more likely next year's
  // instance than one that already passed months ago.
  return month < referenceDate.getUTCMonth() - 1 ? year + 1 : year;
}

/**
 * The best registered-event match for a discovered candidate, or null.
 *
 * Known events are pre-filtered by the caller to a reasonable window (the
 * probe only runs broad "what's happening soon" queries); this only scores
 * title similarity, optionally corroborated by a date guess when one could
 * be extracted.
 */
export function findEventMatch(
  candidate: DiscoveryMissCandidate,
  knownEvents: KnownEvent[],
  referenceDate: Date = new Date(),
): KnownEvent | null {
  if (knownEvents.length === 0) return null;

  const guessedDate = guessDateFromText(`${candidate.title} ${candidate.snippet ?? ""}`, referenceDate);

  let best: { event: KnownEvent; score: number } | null = null;
  for (const known of knownEvents) {
    const sim = titleSimilarity(candidate.title, known.name);
    if (sim < 0.3) continue; // not even close — cheap to skip before date math

    let score = sim;
    if (guessedDate) {
      const daysApart = Math.abs(new Date(known.startAt).getTime() - guessedDate.getTime()) / 86_400_000;
      if (daysApart <= 1) score += 0.15;
      else if (daysApart > 3) score -= 0.2; // corroborating evidence disagreeing is worse than none at all
    }

    if (!best || score > best.score) best = { event: known, score };
  }

  return best && best.score >= MATCH_THRESHOLD ? best.event : null;
}
