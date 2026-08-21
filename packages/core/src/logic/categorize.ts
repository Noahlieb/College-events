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
  for (const category of EVENT_CATEGORIES) {
    if (category === "other") continue;
    const keywords = CATEGORY_KEYWORDS[category];
    if (keywords.some((kw) => text.includes(kw))) {
      matches.push(category);
    }
  }

  if (matches.length === 0) {
    return { category: "other", tags: [] };
  }

  // Rank by keyword-list order priority for the primary category.
  const primary = CATEGORY_PRIORITY.find((c) => matches.includes(c)) ?? matches[0]!;
  return { category: primary, tags: matches };
}

const CATEGORY_KEYWORDS: Record<Exclude<EventCategory, "other">, string[]> = {
  campus: ["owl central", "student union", "fau campus", "on campus", "campus event"],
  student_org: ["student organization", "student org", "club meeting", "greek life", "fraternity", "sorority", "rush"],
  sports: ["game", "vs.", "vs ", "kickoff", "tailgate", "owls football", "owls basketball", "athletics"],
  concert: ["concert", "live music", "tour", "performing", "band", "artist", "festival stage"],
  nightlife: ["nightclub", "club night", "dj ", " dj", "bottle service", "college night", "party bus", "bar crawl"],
  party: ["party", "rager", "kickback", "mixer"],
  food_drink: ["free food", "happy hour", "brunch", "tasting", "food truck", "restaurant week", "drink specials"],
  fitness: ["run club", "5k", "yoga", "pickleball", "workout", "fitness class"],
  comedy: ["comedy", "stand-up", "standup", "open mic"],
  festival: ["festival", "fair", "market", "expo"],
  career: ["career fair", "networking event", "resume", "internship", "recruiting", "job fair"],
  academic: ["lecture", "seminar", "workshop", "info session", "study session"],
  networking: ["networking", "mixer", "meet and greet"],
  community: ["volunteer", "community service", "fundraiser", "charity"],
  dating: ["speed dating", "singles night", "matchmaking"],
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
