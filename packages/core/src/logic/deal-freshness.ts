import type { FreshnessStatus } from "../types/deals-enums.js";

export interface FreshnessInput {
  startDate?: string | null;
  expirationDate?: string | null;
  dateDiscovered: string;
  recurring: boolean;
  /** True when this run's extraction differs from the previously stored
   * version of the same offer (price/terms changed) — set by the pipeline
   * after comparing against the matched existing deal, not derivable here. */
  changedSinceLastSeen?: boolean;
  today: string;
  newWindowDays?: number;
  expiringSoonDays?: number;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

/**
 * Classifies a deal's freshness (spec Phase 5's status list). Never invents
 * an expiration — a deal with no expirationDate simply skips the
 * expired/expiring_soon branches rather than guessing one.
 */
export function computeFreshnessStatus(input: FreshnessInput): FreshnessStatus {
  const { expirationDate, dateDiscovered, recurring, changedSinceLastSeen, today } = input;
  const newWindowDays = input.newWindowDays ?? 3;
  const expiringSoonDays = input.expiringSoonDays ?? 3;

  if (expirationDate) {
    const daysToExpiry = daysBetween(today, expirationDate);
    if (daysToExpiry < 0) return "expired";
    if (daysToExpiry <= expiringSoonDays) return "expiring_soon";
  }

  if (changedSinceLastSeen) return "updated";
  if (recurring) return "recurring";

  const daysSinceDiscovered = daysBetween(dateDiscovered, today);
  if (daysSinceDiscovered <= newWindowDays) return "new";
  if (expirationDate || input.startDate) return "active";
  return "unknown";
}

/**
 * A permanent discount with no time window at all, gated only by a student
 * ID — "10% off with UCF ID" — belongs in the evergreen library rather than
 * repeating as standalone feed content (spec Phase 8/"evergreen discounts
 * cannot dominate"). BOGO/free-item promos are excluded even if they lack
 * explicit dates, since those are the fresh/urgent inventory the spec wants
 * to prioritize, not the evergreen library.
 */
export function isEvergreenDeal(input: {
  recurring: boolean;
  expirationDate?: string | null;
  startDate?: string | null;
  studentIdRequired: boolean;
  isBogo: boolean;
  isFreeItem: boolean;
}): boolean {
  return (
    !input.expirationDate &&
    !input.startDate &&
    input.studentIdRequired &&
    !input.isBogo &&
    !input.isFreeItem
  );
}
