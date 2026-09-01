import { EVENT_CATEGORIES, type EventCategory } from "../types/enums.js";

/**
 * Deterministic keyword-based category classifier. Used as (a) a fast
 * pre-filter/sanity check on AI output, (b) the classifier for manual
 * entries with no AI call, and (c) a fallback when the AI provider errors.
 * Returns primary category plus any additional matching tags.
 */
export function categorizeEvent(input: {
  name: string;
  description?: string | null;
  organization?: string | null;
}): { category: EventCategory; tags: EventCategory[] } {
  const text = [input.name, input.description, input.organization]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matches: EventCategory[] = [];
  const scores = new Map<EventCategory, number>();
  for (const category of EVENT_CATEGORIES) {
    if (category === "other") continue;
    const keywords = CATEGORY_KEYWORDS[category];
    let score = 0;
    for (const [kw, weight] of keywords) {
      if (text.includes(kw)) score += weight;
    }
    if (score > 0) {
      matches.push(category);
      scores.set(category, score);
    }
  }

  if (matches.length === 0) {
    return { category: "other", tags: [] };
  }

  // Primary category is whichever has the strongest keyword evidence, not
  // whichever sits first in a fixed order — see the doc comment on
  // CATEGORY_KEYWORDS for why a fixed order used to mis-sort an event like
  // a nightlife afterparty that merely mentions "the game" into "sports".
  // Ties (including the common case of exactly one category matching at
  // all) fall back to CATEGORY_PRIORITY for a stable, deterministic pick.
  const topScore = Math.max(...matches.map((c) => scores.get(c)!));
  const tied = matches.filter((c) => scores.get(c) === topScore);
  const primary = CATEGORY_PRIORITY.find((c) => tied.includes(c)) ?? tied[0]!;
  return { category: primary, tags: matches };
}

/**
 * [keyword, weight] pairs. Weight defaults to 1 for a keyword that's a
 * reliable signal of its category on its own. A handful of sports keywords
 * are deliberately down-weighted to 0.5: "game" and "vs"/"vs." are the
 * classic false-positive triggers — they show up constantly in event copy
 * that isn't actually about a sporting event ("after the game," "trivia
 * game," "block party vs. the world," a nightclub afterparty themed around
 * game day). Under the old fixed-priority scheme, one incidental hit on
 * either word was enough to make "sports" win outright over a nightlife
 * event with three or four genuine nightlife keywords (DJ, bottle service,
 * nightclub) in the same text. Scoring by weighted keyword count instead
 * means those distinctive nightlife/party signals now correctly outweigh
 * a lone generic sports mention, while a real game listing — which usually
 * also has "kickoff," "tailgate," or a team name like "owls football" —
 * still adds up to a clear sports win.
 */
const CATEGORY_KEYWORDS: Record<Exclude<EventCategory, "other">, [string, number][]> = {
  campus: [["owl central", 1], ["student union", 1], ["fau campus", 1], ["on campus", 1], ["campus event", 1]],
  student_org: [
    ["student organization", 1],
    ["student org", 1],
    ["club meeting", 1],
    ["greek life", 1],
    ["fraternity", 1],
    ["sorority", 1],
    ["rush", 1],
  ],
  sports: [
    ["game", 0.5],
    ["vs.", 0.5],
    ["vs ", 0.5],
    ["kickoff", 1],
    ["tailgate", 1],
    ["owls football", 1],
    ["owls basketball", 1],
    ["athletics", 1],
  ],
  concert: [["concert", 1], ["live music", 1], ["tour", 1], ["performing", 1], ["band", 1], ["artist", 1], ["festival stage", 1]],
  nightlife: [
    ["nightclub", 1],
    ["club night", 1],
    ["dj ", 1],
    [" dj", 1],
    ["bottle service", 1],
    ["college night", 1],
    ["party bus", 1],
    ["bar crawl", 1],
  ],
  party: [["party", 1], ["rager", 1], ["kickback", 1], ["mixer", 1]],
  food_drink: [
    ["free food", 1],
    ["happy hour", 1],
    ["brunch", 1],
    ["tasting", 1],
    ["food truck", 1],
    ["restaurant week", 1],
    ["drink specials", 1],
  ],
  fitness: [["run club", 1], ["5k", 1], ["yoga", 1], ["pickleball", 1], ["workout", 1], ["fitness class", 1]],
  comedy: [["comedy", 1], ["stand-up", 1], ["standup", 1], ["open mic", 1]],
  festival: [["festival", 1], ["fair", 1], ["market", 1], ["expo", 1]],
  career: [["career fair", 1], ["networking event", 1], ["resume", 1], ["internship", 1], ["recruiting", 1], ["job fair", 1]],
  academic: [["lecture", 1], ["seminar", 1], ["workshop", 1], ["info session", 1], ["study session", 1]],
  networking: [["networking", 1], ["mixer", 1], ["meet and greet", 1]],
  community: [["volunteer", 1], ["community service", 1], ["fundraiser", 1], ["charity", 1]],
  dating: [["speed dating", 1], ["singles night", 1], ["matchmaking", 1]],
};

/** Priority order used to pick a single primary category among multiple matches. */
const CATEGORY_PRIORITY: EventCategory[] = [
  "campus",
  "sports",
  "concert",
  "nightlife",
  "party",
  "student_org",
  "career",
  "festival",
  "comedy",
  "food_drink",
  "fitness",
  "academic",
  "networking",
  "community",
  "dating",
  "other",
];
