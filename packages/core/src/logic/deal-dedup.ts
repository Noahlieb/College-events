import { createHash } from "node:crypto";
import type { DealCategory, DedupStatus } from "../types/deals-enums.js";

export interface DealFingerprintInput {
  merchantId: string;
  dealCategory: DealCategory;
  dealPrice?: string | null;
  discountPercent?: number | null;
  discountDollars?: number | null;
  isBogo: boolean;
  isFreeItem: boolean;
  validDaysOfWeek: number[];
  promoCode?: string | null;
  locationRestrictions?: string | null;
}

/** Merchant + offer + price + day + promo code + location, hashed (spec
 * Phase 6). Deliberately includes price/discount so a genuinely new offer
 * at a merchant that already has a recurring deal still reads as NEW rather
 * than silently merging into the old one. */
export function computeDealFingerprint(input: DealFingerprintInput): string {
  const parts = [
    input.merchantId,
    input.dealCategory,
    (input.dealPrice ?? "").trim().toLowerCase(),
    input.discountPercent != null ? `pct:${input.discountPercent}` : "",
    input.discountDollars != null ? `usd:${input.discountDollars}` : "",
    input.isBogo ? "bogo" : "",
    input.isFreeItem ? "free" : "",
    [...input.validDaysOfWeek].sort((a, b) => a - b).join(","),
    (input.promoCode ?? "").trim().toLowerCase(),
    (input.locationRestrictions ?? "").trim().toLowerCase(),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** Same offer "slot" (merchant/category/code/days) regardless of price —
 * used to detect UPDATED (terms changed) vs. a wholly NEW offer. */
function sameOfferFamily(a: DealFingerprintInput, b: DealFingerprintInput): boolean {
  const daysA = [...a.validDaysOfWeek].sort((x, y) => x - y).join(",");
  const daysB = [...b.validDaysOfWeek].sort((x, y) => x - y).join(",");
  return (
    a.merchantId === b.merchantId &&
    a.dealCategory === b.dealCategory &&
    (a.promoCode ?? "").trim().toLowerCase() === (b.promoCode ?? "").trim().toLowerCase() &&
    daysA === daysB
  );
}

export interface ExistingDealForDedup extends DealFingerprintInput {
  id: string;
  fingerprint: string;
  expirationDate?: string | null;
}

export interface DedupClassification {
  status: DedupStatus;
  matchedDealId?: string;
}

/**
 * Classifies an incoming extracted offer against everything already stored
 * for the merchant (spec Phase 6): NEW, UPDATED, EXISTING_RECURRING, or
 * DUPLICATE. Conservative by design, same stance as the events product's
 * `areDuplicates` — an exact fingerprint match against an unexpired deal is
 * a duplicate; against an expired one it's the same recurring offer coming
 * back around; a same-family-different-terms match is an update; anything
 * else is new inventory.
 */
export function classifyIncomingDeal(
  incoming: DealFingerprintInput,
  existing: ExistingDealForDedup[],
  today: string,
): DedupClassification {
  const fingerprint = computeDealFingerprint(incoming);

  const exactMatch = existing.find((e) => e.fingerprint === fingerprint);
  if (exactMatch) {
    const expired = !!exactMatch.expirationDate && exactMatch.expirationDate < today;
    return expired
      ? { status: "existing_recurring", matchedDealId: exactMatch.id }
      : { status: "duplicate", matchedDealId: exactMatch.id };
  }

  const familyMatch = existing.find((e) => sameOfferFamily(e, incoming));
  if (familyMatch) return { status: "updated", matchedDealId: familyMatch.id };

  return { status: "new" };
}
