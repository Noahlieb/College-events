import type { DealCategory, FreshnessStatus } from "../types/deals-enums.js";
import { distanceMiles, geoScore, type GeoScoreTier } from "./geo.js";

export interface DealScoreFactors {
  dealCategory: DealCategory;
  merchantLatitude: number;
  merchantLongitude: number;
  campusLatitude: number;
  campusLongitude: number;
  dealPrice?: string | null;
  discountPercent?: number | null;
  discountDollars?: number | null;
  isBogo: boolean;
  isFreeItem: boolean;
  studentIdRequired: boolean;
  freshnessStatus: FreshnessStatus;
  /** The merchant's own 0-100 relevance score (category fit + proximity +
   * promo history) — NOT follower count, per spec's explicit instruction. */
  merchantStudentRelevanceScore: number;
  /** -1..1 learned signal from past similar deals' performance_metrics
   * (spec Phase 14). Optional — absent until performance history exists,
   * in which case shareability falls back to the category/format prior. */
  priorSimilarPerformanceIndex?: number | null;
  proximityTiers?: GeoScoreTier[];
}

export interface DealScoreWeights {
  studentUsefulness: number;
  savingsValue: number;
  proximity: number;
  freshnessUrgency: number;
  shareability: number;
  merchantRelevance: number;
}

/** Spec Phase 7's suggested weighting. Deliberately mutable/overridable —
 * the spec explicitly asks for weights that can be tuned later. */
export const DEFAULT_DEAL_SCORE_WEIGHTS: DealScoreWeights = {
  studentUsefulness: 0.25,
  savingsValue: 0.2,
  proximity: 0.15,
  freshnessUrgency: 0.15,
  shareability: 0.15,
  merchantRelevance: 0.1,
};

/** A merchant 0.5mi away must clearly outrank one 7mi away (spec Phase 1) —
 * steeper decay than the events product's metro-wide tiers, tuned for a
 * walkable/short-drive campus radius instead of a whole city. */
export const DEFAULT_DEAL_PROXIMITY_TIERS: GeoScoreTier[] = [
  { maxMiles: 0.5, score: 100 },
  { maxMiles: 1.5, score: 92 },
  { maxMiles: 3, score: 80 },
  { maxMiles: 5, score: 60 },
  { maxMiles: 7, score: 40 },
  { maxMiles: Infinity, score: 15 },
];

const CATEGORY_STUDENT_USEFULNESS: Record<DealCategory, number> = {
  food_restaurant: 80,
  coffee_cafe: 75,
  dessert: 70,
  fast_casual: 80,
  pizza_wings: 82,
  bar_nightlife: 65,
  fitness: 60,
  beauty_barber_nails: 55,
  entertainment: 65,
  housing: 55,
  retail_services: 45,
  other: 35,
};

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));

function studentUsefulnessScore(f: DealScoreFactors): number {
  let base = CATEGORY_STUDENT_USEFULNESS[f.dealCategory];
  if (f.isFreeItem) base += 15;
  if (f.isBogo) base += 10;
  return clamp(base);
}

/** "$6 burgers" beats "20% off nails" beats "5% off something obscure" —
 * concrete, student-budget-sized savings score highest; a vague permanent
 * discount with no number attached scores lowest (spec Phase 7 examples). */
function savingsValueScore(f: DealScoreFactors): number {
  if (f.isFreeItem) return 100;
  if (f.isBogo) return 90;
  if (f.discountPercent != null) {
    if (f.discountPercent >= 50) return 90;
    if (f.discountPercent >= 30) return 75;
    if (f.discountPercent >= 15) return 55;
    return 35;
  }
  if (f.discountDollars != null) {
    if (f.discountDollars >= 10) return 85;
    if (f.discountDollars >= 5) return 65;
    return 45;
  }
  if (f.dealPrice) {
    const amount = parseFloat(f.dealPrice.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(amount)) {
      if (amount <= 6) return 85;
      if (amount <= 10) return 65;
      if (amount <= 15) return 45;
      return 30;
    }
  }
  return f.studentIdRequired ? 30 : 25;
}

function proximityScore(f: DealScoreFactors): number {
  const miles = distanceMiles(f.campusLatitude, f.campusLongitude, f.merchantLatitude, f.merchantLongitude);
  return geoScore(miles, f.proximityTiers ?? DEFAULT_DEAL_PROXIMITY_TIERS);
}

const FRESHNESS_URGENCY_SCORE: Record<FreshnessStatus, number> = {
  new: 100,
  expiring_soon: 95,
  updated: 80,
  active: 65,
  recurring: 55,
  unknown: 35,
  expired: 0,
};

function freshnessUrgencyScore(f: DealScoreFactors): number {
  return FRESHNESS_URGENCY_SCORE[f.freshnessStatus];
}

/** Free/BOGO/giveaway-shaped deals get shared; a permanent %-off-with-ID
 * discount does not, even though it's genuinely useful (spec: "Apple
 * education gift card... low for our purposes even if technically
 * valuable"). `priorSimilarPerformanceIndex` lets real Instagram
 * performance (Phase 14) override this prior once it exists. */
function shareabilityScore(f: DealScoreFactors): number {
  let base = f.isFreeItem ? 90 : f.isBogo ? 85 : 55;
  if (f.dealCategory === "bar_nightlife") base -= 10;
  if (f.studentIdRequired && !f.isFreeItem && !f.isBogo) base -= 15;
  if (f.priorSimilarPerformanceIndex != null) {
    base = base + f.priorSimilarPerformanceIndex * 25;
  }
  return clamp(base);
}

function merchantRelevanceScore(f: DealScoreFactors): number {
  return clamp(f.merchantStudentRelevanceScore);
}

export interface DealScoreBreakdown {
  studentUsefulness: number;
  savingsValue: number;
  proximity: number;
  freshnessUrgency: number;
  shareability: number;
  merchantRelevance: number;
}

export interface DealScoreResult {
  overall: number;
  breakdown: DealScoreBreakdown;
}

/** The 0-100 Deal Quality Score (spec Phase 7). Pure and side-effect-free —
 * callers persist `overall`/`breakdown` onto the deal row themselves. */
export function scoreDeal(
  factors: DealScoreFactors,
  weights: DealScoreWeights = DEFAULT_DEAL_SCORE_WEIGHTS,
): DealScoreResult {
  const breakdown: DealScoreBreakdown = {
    studentUsefulness: studentUsefulnessScore(factors),
    savingsValue: savingsValueScore(factors),
    proximity: proximityScore(factors),
    freshnessUrgency: freshnessUrgencyScore(factors),
    shareability: shareabilityScore(factors),
    merchantRelevance: merchantRelevanceScore(factors),
  };

  const overall = clamp(
    breakdown.studentUsefulness * weights.studentUsefulness +
      breakdown.savingsValue * weights.savingsValue +
      breakdown.proximity * weights.proximity +
      breakdown.freshnessUrgency * weights.freshnessUrgency +
      breakdown.shareability * weights.shareability +
      breakdown.merchantRelevance * weights.merchantRelevance,
  );

  return { overall, breakdown };
}
