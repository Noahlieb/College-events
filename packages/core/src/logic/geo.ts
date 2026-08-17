/** Haversine distance in miles between two lat/lng points. */
export function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.8; // earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface GeoScoreTier {
  maxMiles: number;
  score: number;
}

/**
 * Distance-decay geography score, 0-100. Tiers are configurable per school
 * (a future school with a more spread-out metro can pass wider bands).
 * Default tiers are tuned for FAU/Boca Raton: campus/Boca/Delray score very
 * high, Fort Lauderdale moderate, Miami low unless the event overrides it.
 */
export function geoScore(
  distanceFromCampusMiles: number,
  tiers: GeoScoreTier[] = DEFAULT_FAU_GEO_TIERS,
): number {
  for (const tier of tiers) {
    if (distanceFromCampusMiles <= tier.maxMiles) return tier.score;
  }
  return 0;
}

export const DEFAULT_FAU_GEO_TIERS: GeoScoreTier[] = [
  { maxMiles: 3, score: 100 }, // on/near campus
  { maxMiles: 12, score: 90 }, // Boca Raton
  { maxMiles: 20, score: 80 }, // Delray Beach
  { maxMiles: 35, score: 55 }, // Fort Lauderdale
  { maxMiles: 55, score: 30 }, // Miami metro
  { maxMiles: Infinity, score: 10 },
];
