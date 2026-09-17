import { and, eq } from "drizzle-orm";
import { db, dealRawContent, deals, merchants, merchantSources, schools } from "@college-events/db";
import {
  classifyContentEligibility,
  classifyIncomingDeal,
  computeDealFingerprint,
  computeFreshnessStatus,
  isEvergreenDeal,
  scoreDeal,
  type DealCategory,
  type ExistingDealForDedup,
} from "@college-events/core";
import { createAIProvider, type AIProvider } from "@college-events/ai";
import { log } from "../lib/log.js";

export interface ProcessDealsSummary {
  inspected: number;
  rejectedNotADeal: number;
  created: number;
  updated: number;
  duplicatesSkipped: number;
  recurringReactivated: number;
  errored: number;
}

/**
 * Runs AI extraction → fingerprint/dedup → freshness → quality score →
 * content eligibility over every `pending` deal_raw_content row for a
 * university (spec Phases 5-8). Mirrors the events product's
 * processSchoolRawContent shape: every item processed independently,
 * failures never abort the batch.
 */
export async function processUniversityDeals(
  universityId: string,
  aiProvider: AIProvider = createAIProvider(),
): Promise<ProcessDealsSummary> {
  const [university] = await db.select().from(schools).where(eq(schools.id, universityId)).limit(1);
  if (!university) throw new Error(`Unknown university ${universityId}`);

  const pending = await db
    .select({ raw: dealRawContent, merchant: merchants, source: merchantSources })
    .from(dealRawContent)
    .innerJoin(merchants, eq(dealRawContent.merchantId, merchants.id))
    .innerJoin(merchantSources, eq(dealRawContent.merchantSourceId, merchantSources.id))
    .where(and(eq(dealRawContent.universityId, universityId), eq(dealRawContent.processingStatus, "pending")));

  const summary: ProcessDealsSummary = {
    inspected: 0,
    rejectedNotADeal: 0,
    created: 0,
    updated: 0,
    duplicatesSkipped: 0,
    recurringReactivated: 0,
    errored: 0,
  };
  const today = new Date().toISOString().slice(0, 10);

  for (const { raw, merchant, source } of pending) {
    summary.inspected++;
    try {
      const extracted = await aiProvider.extractDeal({
        universityContext: {
          name: university.name,
          shortName: university.shortName,
          city: university.city,
          state: university.state,
          timezone: university.timezone,
        },
        merchantName: merchant.name,
        merchantCategory: merchant.category,
        sourceType: source.sourceType,
        sourceUrl: raw.sourceUrl,
        rawText: raw.rawText,
        currentDate: today,
      });

      if (!extracted.is_deal) {
        await db.update(dealRawContent).set({ processingStatus: "rejected" }).where(eq(dealRawContent.id, raw.id));
        summary.rejectedNotADeal++;
        continue;
      }

      const dealCategory = (extracted.deal_category ?? "other") as DealCategory;
      const fingerprintInput = {
        merchantId: merchant.id,
        dealCategory,
        dealPrice: extracted.deal_price,
        discountPercent: extracted.discount_percent,
        discountDollars: extracted.discount_dollars,
        isBogo: extracted.is_bogo,
        isFreeItem: extracted.is_free_item,
        validDaysOfWeek: extracted.valid_days_of_week,
        promoCode: extracted.promo_code,
        locationRestrictions: extracted.location_restrictions,
      };
      const fingerprint = computeDealFingerprint(fingerprintInput);

      const existingForMerchant = await db.select().from(deals).where(eq(deals.merchantId, merchant.id));
      const existingForDedup: ExistingDealForDedup[] = existingForMerchant.map((d) => ({
        id: d.id,
        merchantId: d.merchantId,
        dealCategory: d.dealCategory,
        dealPrice: d.dealPrice,
        discountPercent: d.discountPercent,
        discountDollars: d.discountDollars,
        isBogo: d.isBogo,
        isFreeItem: d.isFreeItem,
        validDaysOfWeek: d.validDaysOfWeek,
        promoCode: d.promoCode,
        locationRestrictions: d.locationRestrictions,
        fingerprint: d.fingerprint,
        expirationDate: d.expirationDate,
      }));
      const dedup = classifyIncomingDeal(fingerprintInput, existingForDedup, today);

      if (dedup.status === "duplicate") {
        await db.update(dealRawContent).set({ processingStatus: "processed" }).where(eq(dealRawContent.id, raw.id));
        summary.duplicatesSkipped++;
        continue;
      }

      const freshnessStatus = computeFreshnessStatus({
        startDate: extracted.start_date,
        expirationDate: extracted.expiration_date,
        dateDiscovered: today,
        recurring: extracted.recurring,
        changedSinceLastSeen: dedup.status === "updated",
        today,
      });

      const evergreen = isEvergreenDeal({
        recurring: extracted.recurring,
        expirationDate: extracted.expiration_date,
        startDate: extracted.start_date,
        studentIdRequired: extracted.student_id_required,
        isBogo: extracted.is_bogo,
        isFreeItem: extracted.is_free_item,
      });

      const { overall, breakdown } = scoreDeal({
        dealCategory,
        merchantLatitude: merchant.latitude,
        merchantLongitude: merchant.longitude,
        campusLatitude: university.latitude,
        campusLongitude: university.longitude,
        dealPrice: extracted.deal_price,
        discountPercent: extracted.discount_percent,
        discountDollars: extracted.discount_dollars,
        isBogo: extracted.is_bogo,
        isFreeItem: extracted.is_free_item,
        studentIdRequired: extracted.student_id_required,
        freshnessStatus,
        merchantStudentRelevanceScore: merchant.studentRelevanceScore,
      });

      const contentEligibility = classifyContentEligibility(overall, evergreen);
      const title = extracted.title ?? `${merchant.name} deal`;
      const cleanDescription = extracted.clean_offer_description ?? raw.rawText?.slice(0, 280) ?? title;
      // Never auto-mark a low-confidence extraction as trustworthy (spec
      // Phase 11) — "verified" is reserved for the human/corroboration path.
      const verificationStatus = extracted.confidence < 0.4 ? "needs_review" : "high_confidence";

      const sharedFields = {
        title,
        rawOfferText: raw.rawText,
        cleanOfferDescription: cleanDescription,
        dealCategory,
        normalPrice: extracted.normal_price,
        dealPrice: extracted.deal_price,
        discountPercent: extracted.discount_percent,
        discountDollars: extracted.discount_dollars,
        isBogo: extracted.is_bogo,
        isFreeItem: extracted.is_free_item,
        studentIdRequired: extracted.student_id_required,
        promoCode: extracted.promo_code,
        validDaysOfWeek: extracted.valid_days_of_week,
        startDate: extracted.start_date,
        expirationDate: extracted.expiration_date,
        startTime: extracted.start_time,
        endTime: extracted.end_time,
        recurring: extracted.recurring,
        recurrencePattern: extracted.recurrence_pattern,
        locationRestrictions: extracted.location_restrictions,
        minimumPurchase: extracted.minimum_purchase,
        eligibility: extracted.eligibility,
        sourceUrl: raw.sourceUrl,
        dateLastVerified: new Date(),
        confidenceScore: extracted.confidence,
        verificationStatus,
        freshnessStatus,
        qualityScore: overall,
        qualityBreakdown: breakdown,
        contentEligibility,
        fingerprint,
        dedupStatus: dedup.status,
      } as const;

      if (dedup.matchedDealId) {
        await db
          .update(deals)
          .set({ ...sharedFields, updatedAt: new Date() })
          .where(eq(deals.id, dedup.matchedDealId));
        if (dedup.status === "existing_recurring") summary.recurringReactivated++;
        else summary.updated++;
      } else {
        await db.insert(deals).values({
          ...sharedFields,
          merchantId: merchant.id,
          universityId,
          sourceType: source.sourceType,
          dateDiscovered: new Date(),
          submissionSource: "scraped",
        });
        summary.created++;
      }

      await db.update(dealRawContent).set({ processingStatus: "processed" }).where(eq(dealRawContent.id, raw.id));
    } catch (err) {
      summary.errored++;
      await db.update(dealRawContent).set({ processingStatus: "error" }).where(eq(dealRawContent.id, raw.id));
      await log(
        universityId,
        "error",
        "deals.ai.extract",
        `Failed to process deal_raw_content ${raw.id}: ${(err as Error).message}`,
        { rawContentId: raw.id },
      );
    }
  }

  return summary;
}
