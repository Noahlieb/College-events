/**
 * Rough city-name-to-distance lookup used only when we have no coordinates
 * for an AI-extracted event (the extraction schema returns a city string,
 * not lat/lng — there's no geocoding step in the MVP). Good enough to feed
 * scoreEvent()'s distance-decay curve; a real geocoder (or venue lookup
 * table per source) is a natural post-MVP upgrade noted in the README.
 */
const KNOWN_CITY_DISTANCES_FROM_FAU: Record<string, number> = {
  "boca raton": 2,
  "delray beach": 9,
  "boynton beach": 6,
  "deerfield beach": 12,
  "lake worth": 14,
  "west palm beach": 18,
  "pompano beach": 17,
  "fort lauderdale": 24,
  "hollywood": 32,
  "miami": 45,
  "coral gables": 42,
};

export function estimateDistanceMiles(city: string | null, schoolCity: string): number | null {
  if (!city) return null;
  const key = city.trim().toLowerCase();
  if (key === schoolCity.trim().toLowerCase()) return 2;
  return KNOWN_CITY_DISTANCES_FROM_FAU[key] ?? null;
}

export function isCampusAffiliated(
  organization: string | null,
  schoolName: string,
  schoolShortName: string,
  sourceCategory: string,
): boolean {
  if (sourceCategory === "campus") return true;
  if (!organization) return false;
  const org = organization.toLowerCase();
  return org.includes(schoolShortName.toLowerCase()) || org.includes(schoolName.toLowerCase());
}
