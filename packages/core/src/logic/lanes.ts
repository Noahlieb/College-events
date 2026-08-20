import type { EventCategory, PostType } from "../types/enums.js";
import type { BucketScores } from "../types/domain.js";

export type PostBucket = keyof Omit<BucketScores, "overall">;

/**
 * The weekly posting lanes and the ONLY event categories each one may
 * contain. This is a hard partition, not a preference: bucket scores rank
 * events *within* a lane, but they can never move an event across lanes.
 * That separation is a product requirement — a nightlife promo appearing in
 * the campus post (or vice versa) is worse than posting nothing at all, so
 * category membership is enforced as a filter at selection time and
 * re-asserted before anything is written to a post (see assertLanePurity).
 *
 * Categories listed in no lane are intentionally never auto-posted; they can
 * still be surfaced to a human and force-included from the dashboard.
 */
export interface PostLane {
  postType: PostType;
  bucket: PostBucket;
  categories: readonly EventCategory[];
}

export const POST_LANES: readonly PostLane[] = [
  {
    postType: "monday_campus",
    bucket: "mondayCampus",
    // Campus life + anything the athletics department puts on.
    categories: ["campus", "student_org", "sports"],
  },
  {
    postType: "thursday_nightlife",
    bucket: "thursdayNightlife",
    // Strictly nightlife. Sources that only ever produce nightlife (Posh.vip)
    // pin their events to this category at ingest via metadata.forceCategory,
    // so their events can only ever land here.
    categories: ["nightlife"],
  },
] as const;

export function laneForPostType(postType: string): PostLane | undefined {
  return POST_LANES.find((l) => l.postType === postType);
}

/** The lane an event belongs to, or undefined when its category is not
 * auto-posted in any lane. */
export function laneForCategory(category: EventCategory): PostLane | undefined {
  return POST_LANES.find((l) => l.categories.includes(category));
}

export function isCategoryAllowedInLane(postType: string, category: EventCategory): boolean {
  return laneForPostType(postType)?.categories.includes(category) ?? false;
}

export class LanePurityError extends Error {
  constructor(
    readonly postType: string,
    readonly offenders: { id: string; category: EventCategory }[],
  ) {
    super(
      `Refusing to build "${postType}": ${offenders.length} event(s) whose category is not allowed in this lane ` +
        `(${offenders.map((o) => `${o.id}=${o.category}`).join(", ")}). Allowed: ` +
        `${laneForPostType(postType)?.categories.join(", ") ?? "(no such lane)"}.`,
    );
    this.name = "LanePurityError";
  }
}

/**
 * Final gate before events are written into a post. Selection already
 * filters by category, so reaching this with an offender means a bug or a
 * hand-forced event slipped through — either way the post must not ship
 * mixed content, so this throws rather than silently dropping.
 */
export function assertLanePurity(postType: string, events: { id: string; category: EventCategory }[]): void {
  const offenders = events.filter((e) => !isCategoryAllowedInLane(postType, e.category));
  if (offenders.length > 0) throw new LanePurityError(postType, offenders);
}
