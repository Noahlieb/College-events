import { distanceMiles } from "./geo.js";

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dice coefficient over character bigrams — robust to small wording differences
 * ("Back 2 School Bash" vs "Back-to-School Bash") without needing an ML model. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const bigrams = (s: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.length === 0 || bb.length === 0) return na === nb ? 1 : 0;

  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);

  let matches = 0;
  for (const g of bb) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      matches++;
      counts.set(g, c - 1);
    }
  }
  return (2 * matches) / (ba.length + bb.length);
}

export interface DedupCandidate {
  id: string;
  name: string;
  startAt: string; // ISO
  venue?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  organization?: string | null;
}

export interface DedupResult {
  isDuplicate: boolean;
  score: number; // 0..1 composite confidence they are the same event
  reasons: string[];
}

const SAME_DAY_WINDOW_HOURS = 6;

/**
 * Decide whether two extracted events are almost certainly the same
 * real-world event (spec §15). Combines title similarity, date proximity,
 * venue/organization match, and geographic proximity when coordinates are
 * known. Conservative by design — a false merge is worse than a missed one.
 */
export function areDuplicates(a: DedupCandidate, b: DedupCandidate): DedupResult {
  const reasons: string[] = [];

  const titleSim = titleSimilarity(a.name, b.name);
  if (titleSim >= 0.6) reasons.push(`title similarity ${titleSim.toFixed(2)}`);

  const hoursApart = Math.abs(new Date(a.startAt).getTime() - new Date(b.startAt).getTime()) / 36e5;
  const sameDay = hoursApart <= SAME_DAY_WINDOW_HOURS;
  if (sameDay) reasons.push(`same start window (${hoursApart.toFixed(1)}h apart)`);

  let venueMatch = false;
  if (a.venue && b.venue) {
    const venueSim = titleSimilarity(a.venue, b.venue);
    venueMatch = venueSim >= 0.7;
    if (venueMatch) reasons.push(`venue match "${a.venue}" ~ "${b.venue}"`);
  }

  let geoClose = false;
  if (a.latitude != null && a.longitude != null && b.latitude != null && b.longitude != null) {
    const dist = distanceMiles(a.latitude, a.longitude, b.latitude, b.longitude);
    geoClose = dist <= 0.25;
    if (geoClose) reasons.push(`coordinates ${dist.toFixed(2)}mi apart`);
  }

  const orgMatch =
    !!a.organization && !!b.organization && titleSimilarity(a.organization, b.organization) >= 0.7;
  if (orgMatch) reasons.push(`organization match`);

  const locationSignal = venueMatch || geoClose;

  // Decision rule: strong title match + same time window is enough on its own;
  // a moderate title match needs corroborating venue/org/geo evidence.
  const isDuplicate =
    (titleSim >= 0.82 && sameDay) ||
    (titleSim >= 0.55 && sameDay && (locationSignal || orgMatch));

  const score = titleSim * 0.5 + (sameDay ? 0.3 : 0) + (locationSignal ? 0.15 : 0) + (orgMatch ? 0.05 : 0);

  return { isDuplicate, score: Math.min(1, score), reasons };
}

/** Group a batch of candidate events into duplicate clusters. Each cluster's
 * first element is treated as the "primary" merge target by the caller. */
export function clusterDuplicates(candidates: DedupCandidate[]): DedupCandidate[][] {
  const clusters: DedupCandidate[][] = [];
  const assigned = new Set<string>();

  for (const candidate of candidates) {
    if (assigned.has(candidate.id)) continue;
    const cluster = [candidate];
    assigned.add(candidate.id);
    for (const other of candidates) {
      if (assigned.has(other.id)) continue;
      if (areDuplicates(candidate, other).isDuplicate) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}
