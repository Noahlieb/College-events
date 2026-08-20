import type { EventCategory } from "../types/enums.js";
import type { BucketScores } from "../types/domain.js";
import { geoScore, type GeoScoreTier } from "./geo.js";

export interface ScoreFactors {
  category: EventCategory;
  /** Distance from the school's campus in miles. Null when the event's
   * location is unknown — treated as a geographic unknown, not "far away". */
  distanceMiles: number | null;
  priceText?: string | null;
  /** True when the organizing body/source is the school itself or an
   * official student org — used for the Monday campus-relevance boost. */
  isCampusAffiliated: boolean;
  /** Negative = already started/passed. Callers must reject expired events
   * separately (see isExpired) rather than relying on a low score here. */
  daysUntilStart: number;
  /** Generic weekly/recurring listings (e.g. a standing happy hour) rank
   * below one-time or seasonal events of similar appeal. */
  isRecurring?: boolean;
  geoTiers?: GeoScoreTier[];
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));

const UNKNOWN_LOCATION_DISTANCE = 15; // treat unknown location as roughly "Boca-area" rather than penalizing to zero

function costScore(priceText?: string | null): number {
  if (!priceText) return 60;
  const t = priceText.toLowerCase();
  if (t.includes("free")) return 100;
  const amounts = [...t.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]!));
  if (amounts.length === 0) return 55;
  const amount = Math.min(...amounts);
  if (amount <= 10) return 85;
  if (amount <= 25) return 70;
  if (amount <= 50) return 50;
  return 30;
}

function timingScore(daysUntilStart: number): number {
  if (daysUntilStart < 0) return 0;
  if (daysUntilStart <= 7) return 100;
  if (daysUntilStart <= 14) return 80;
  if (daysUntilStart <= 30) return 55;
  return 30;
}

function uniquenessScore(isRecurring: boolean): number {
  return isRecurring ? 45 : 90;
}

/** Baseline general student-appeal-by-category, independent of bucket fit. */
const CATEGORY_APPEAL: Record<EventCategory, number> = {
  campus: 65,
  student_org: 55,
  sports: 80,
  concert: 90,
  nightlife: 85,
  party: 75,
  food_drink: 70,
  fitness: 55,
  comedy: 70,
  festival: 80,
  career: 45,
  academic: 35,
  networking: 40,
  community: 45,
  dating: 40,
  other: 40,
};

/**
 * How well each category fits each weekly post bucket, as a multiplier.
 *
 * These only rank events *within* a lane. Which lane an event may appear in
 * at all is decided by logic/lanes.ts — so the near-zero cross-lane values
 * here are belt-and-braces, not the mechanism. Note `sports` scores well in
 * BOTH real buckets on purpose: lanes route a game by the day it falls on,
 * so the same event needs a competitive score in whichever post claims it.
 * `midweekActivity` is retained so previously-scored rows keep their shape,
 * but no lane consumes it any more (the midweek post was removed).
 */
const BUCKET_AFFINITY: Record<keyof Omit<BucketScores, "overall">, Record<EventCategory, number>> = {
  mondayCampus: {
    campus: 1.15,
    student_org: 1.1,
    // Sports headline the Monday post alongside campus events, so this is a
    // boost rather than the penalty it carried when midweek owned athletics.
    sports: 1.1,
    career: 0.85,
    academic: 0.7,
    networking: 0.65,
    community: 0.65,
    food_drink: 0.7,
    fitness: 0.5,
    festival: 0.5,
    concert: 0.25,
    nightlife: 0.05,
    party: 0.2,
    comedy: 0.35,
    dating: 0.2,
    other: 0.4,
  },
  midweekActivity: {
    sports: 1.1,
    concert: 1.1,
    festival: 1.0,
    comedy: 0.9,
    fitness: 0.8,
    food_drink: 0.65,
    community: 0.55,
    campus: 0.35,
    student_org: 0.35,
    career: 0.25,
    academic: 0.25,
    networking: 0.35,
    nightlife: 0.55,
    party: 0.45,
    dating: 0.35,
    other: 0.45,
  },
  thursdayNightlife: {
    nightlife: 1.15,
    // Weekend games are weekend plans — lanes.ts sends Fri/Sat/Sun sports
    // here, so they must rank alongside nightlife rather than be buried.
    sports: 1.05,
    party: 1.05,
    concert: 0.65,
    comedy: 0.55,
    food_drink: 0.45,
    dating: 0.55,
    festival: 0.45,
    campus: 0.05,
    student_org: 0.1,
    career: 0.05,
    academic: 0.05,
    networking: 0.2,
    fitness: 0.1,
    community: 0.1,
    other: 0.2,
  },
};

/**
 * Score an event for FAU relevance overall and per weekly-post bucket.
 * See spec §13/§14 — geography, student appeal, cost, uniqueness, campus
 * affiliation and timing all contribute; expired events must be filtered
 * out upstream via isExpired() rather than relying on a near-zero score.
 */
export function scoreEvent(factors: ScoreFactors): BucketScores {
  const geo = geoScore(factors.distanceMiles ?? UNKNOWN_LOCATION_DISTANCE, factors.geoTiers);
  const cost = costScore(factors.priceText);
  const timing = timingScore(factors.daysUntilStart);
  const uniqueness = uniquenessScore(factors.isRecurring ?? false);
  const appeal = CATEGORY_APPEAL[factors.category];
  const campusBonus = factors.isCampusAffiliated ? 12 : 0;

  const overall = clamp(
    geo * 0.3 + cost * 0.15 + timing * 0.2 + uniqueness * 0.1 + appeal * 0.25 + (factors.isCampusAffiliated ? 5 : 0),
  );

  const bucketBase = geo * 0.3 + cost * 0.15 + timing * 0.25 + uniqueness * 0.1 + campusBonus;

  const mondayCampus = clamp(bucketBase * BUCKET_AFFINITY.mondayCampus[factors.category]);
  const midweekActivity = clamp(bucketBase * BUCKET_AFFINITY.midweekActivity[factors.category]);
  const thursdayNightlife = clamp(bucketBase * BUCKET_AFFINITY.thursdayNightlife[factors.category]);

  return { overall, mondayCampus, midweekActivity, thursdayNightlife };
}
