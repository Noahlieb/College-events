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

/**
 * Flag set on a sports event that is NOT played at home — SIDEARM's
 * location_indicator of "A" (away) or "N" (neutral site). Neutral counts as
 * away: a tournament three states over is no more attendable than a road game.
 */
export const AWAY_GAME_FLAG = "away_game";

/**
 * True only when the athletics feed affirmatively says a game is away ("A")
 * or at a neutral site ("N").
 *
 * Anything else -- "H", empty, or absent entirely, as it is for every source
 * that isn't the athletics feed -- returns false, leaving the event unflagged
 * and postable. The asymmetry is the point: exclusion requires evidence, so a
 * missing field can never quietly drop a real campus event.
 */
export function isAwayIndicator(indicator: unknown): boolean {
  return typeof indicator === "string" && ["A", "N"].includes(indicator.trim().toUpperCase());
}

/** " at Miami" → away. " vs Merrimack" / " vs. FIU" → home. */
const AT_PATTERN = /\sat\s+\S/i;
const VS_PATTERN = /\svs\.?\s+\S/i;

/**
 * Whether a sports event is at home: true, false, or undefined when nothing
 * says either way.
 *
 * Three signals, most trustworthy first:
 *
 *   locationIndicator  "H" / "A" / "N" — explicit, but FAU's athletics site
 *                      leaves it null, so in practice it rarely fires
 *   atVs               "vs" / "at" — what fausports actually populates
 *   the event name     "FAU at Mercer" vs "FAU vs North Florida", the same
 *                      fact rendered into the title
 *
 * The name is included because events created before this existed have only
 * that left: the indicator was null when they were ingested, so re-reading
 * their raw content proves nothing.
 *
 * Anything with no at/vs at all — "FAU Ice Hockey Club Meeting", "Pulse Dance
 * Troupe Auditions" — returns undefined and stays postable. Club and
 * intramural listings simply aren't matchups.
 */
export function homeAwayForSportsEvent(input: {
  name?: string | null;
  atVs?: unknown;
  locationIndicator?: unknown;
}): boolean | undefined {
  const { name, atVs, locationIndicator } = input;

  if (typeof locationIndicator === "string" && locationIndicator.trim()) {
    if (isAwayIndicator(locationIndicator)) return false;
    if (locationIndicator.trim().toUpperCase() === "H") return true;
  }

  if (typeof atVs === "string" && atVs.trim()) {
    const v = atVs.trim().toLowerCase().replace(/\.$/, "");
    if (v === "at") return false;
    if (v === "vs") return true;
  }

  if (typeof name === "string") {
    // vs first: "FAU vs Miami at Ocean Bank Convocation Center" is a home
    // game named after its venue, and checking "at" first would invert it.
    if (VS_PATTERN.test(name)) return true;
    if (AT_PATTERN.test(name)) return false;
  }

  return undefined;
}

export interface LaneEvent {
  category: EventCategory;
  /** ISO timestamp of the event's start. */
  startAt: string;
  /** IANA timezone of the school the event belongs to. */
  timezone: string;
  /**
   * Whether a sports event is played at home. `false` excludes it from every
   * lane; `true` and `undefined` both route normally.
   *
   * Undefined is deliberately permissive. Only the athletics feed reports
   * home/away, so intramural and club sports arrive without it — and those
   * are on campus by their nature. Treating "unknown" as "away" would delete
   * exactly the campus sports this network exists to promote.
   */
  isHomeGame?: boolean | null;
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
 *   sports, away/neutral   → no lane — a road game isn't something to attend
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
      // Away and neutral-site games are dropped before timing is considered:
      // the post is a list of things to go to, and a game in another state
      // is not one of them regardless of which day it lands on.
      if (event.isHomeGame === false) return undefined;
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
