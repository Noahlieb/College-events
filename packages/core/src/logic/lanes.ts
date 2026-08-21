import { toZonedTime } from "date-fns-tz";
import { parseISO } from "date-fns";
import type { EventCategory, PostType } from "../types/enums.js";
import type { BucketScores } from "../types/domain.js";

export type PostBucket = keyof Omit<BucketScores, "overall">;

/**
 * Friday, Saturday, Sunday — the days the Thursday "Weekend Guide" is
 * previewing. Sunday is 0 in JS's getDay(), so this is [5, 6, 0].
 */
const WEEKEND_DAYS = new Set([5, 6, 0]);

export interface PostLane {
  postType: PostType;
  bucket: PostBucket;
  /** Every category that may EVER appear in this lane. Some are conditional
   * (sports lands here only on certain days) — laneForEvent is the
   * authority, this list is for UI/docs and coarse filtering. */
  categories: readonly EventCategory[];
}

export const MONDAY_CAMPUS_LANE: PostLane = {
  postType: "monday_campus",
  bucket: "mondayCampus",
  categories: ["campus", "student_org", "sports"],
};

export const THURSDAY_NIGHTLIFE_LANE: PostLane = {
  postType: "thursday_nightlife",
  bucket: "thursdayNightlife",
  // Nightlife always; sports only when the game falls on the weekend.
  categories: ["nightlife", "sports"],
};

export const POST_LANES: readonly PostLane[] = [MONDAY_CAMPUS_LANE, THURSDAY_NIGHTLIFE_LANE] as const;

export interface LaneEvent {
  category: EventCategory;
  /** ISO timestamp of the event's start. */
  startAt: string;
  /** IANA timezone of the school the event belongs to. */
  timezone: string;
}

/** True when the event starts on a Fri/Sat/Sun *in the school's local time*.
 * Evaluating this in UTC would misfile most of them — a 9pm Friday kickoff
 * in Florida is already Saturday 01:00 UTC. */
export function isWeekendEvent(startAt: string, timezone: string): boolean {
  return WEEKEND_DAYS.has(toZonedTime(parseISO(startAt), timezone).getDay());
}

/**
 * The single lane an event belongs to, or undefined when its category is
 * not auto-posted at all.
 *
 * Routing is a function of category *and* timing, not category alone:
 *
 *   nightlife              → Thursday, always
 *   sports (Fri/Sat/Sun)   → Thursday — weekend games are weekend plans
 *   sports (Mon-Thu)       → Monday — intramural, club and varsity alike
 *   campus, student_org    → Monday, always
 *   everything else        → no lane (never auto-posted)
 *
 * Because every event resolves to at most one lane here, the lanes are
 * mutually exclusive by construction — there is no way for the same event
 * to satisfy two lanes' rules and appear in both posts.
 */
export function laneForEvent(event: LaneEvent): PostLane | undefined {
  switch (event.category) {
    case "nightlife":
      return THURSDAY_NIGHTLIFE_LANE;
    case "sports":
      return isWeekendEvent(event.startAt, event.timezone) ? THURSDAY_NIGHTLIFE_LANE : MONDAY_CAMPUS_LANE;
    case "campus":
    case "student_org":
      return MONDAY_CAMPUS_LANE;
    default:
      return undefined;
  }
}

export function laneForPostType(postType: string): PostLane | undefined {
  return POST_LANES.find((l) => l.postType === postType);
}

/** Whether this specific event may appear in this specific post. */
export function isEventAllowedInLane(postType: string, event: LaneEvent): boolean {
  return laneForEvent(event)?.postType === postType;
}

export class LanePurityError extends Error {
  constructor(
    readonly postType: string,
    readonly offenders: { id: string; category: EventCategory }[],
  ) {
    super(
      `Refusing to build "${postType}": ${offenders.length} event(s) that do not route to this lane ` +
        `(${offenders.map((o) => `${o.id}=${o.category}`).join(", ")}).`,
    );
    this.name = "LanePurityError";
  }
}

/**
 * Final gate before events are written into a post. Selection already
 * routes by lane, so reaching this with an offender means a bug or a
 * hand-forced event slipped through — either way the post must not ship
 * mixed content, so this throws rather than silently dropping.
 */
export function assertLanePurity(postType: string, events: (LaneEvent & { id: string })[]): void {
  const offenders = events.filter((e) => !isEventAllowedInLane(postType, e));
  if (offenders.length > 0) throw new LanePurityError(postType, offenders);
}
