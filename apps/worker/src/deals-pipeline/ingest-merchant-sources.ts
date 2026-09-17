import { and, eq } from "drizzle-orm";
import { db, dealRawContent, merchantSources, merchants } from "@college-events/db";
import { fetchDealSource } from "@college-events/ingestion";
import { log } from "../lib/log.js";

export interface DealIngestSummary {
  sourcesChecked: number;
  changed: number;
  unchanged: number;
  skippedManual: number;
  failed: number;
}

/**
 * Polls every active, non-manual merchant_sources row for a university
 * (spec Phase 3/4). Fetches the page, normalizes and hashes its text, and
 * — only when the hash differs from the stored one — writes a
 * deal_raw_content row for processUniversityDeals() to extract from. An
 * unchanged page never reaches the LLM.
 *
 * A source marked `scrapingMethod: "manual"` (JS-rendered/login-gated
 * pages the MVP intentionally doesn't attempt) is skipped entirely rather
 * than attempting to defeat whatever's blocking it (spec Phase 3).
 */
export async function ingestUniversityMerchantSources(universityId: string): Promise<DealIngestSummary> {
  const rows = await db
    .select({ source: merchantSources, merchant: merchants })
    .from(merchantSources)
    .innerJoin(merchants, eq(merchantSources.merchantId, merchants.id))
    .where(and(eq(merchants.universityId, universityId), eq(merchantSources.active, true), eq(merchants.active, true)));

  const summary: DealIngestSummary = { sourcesChecked: 0, changed: 0, unchanged: 0, skippedManual: 0, failed: 0 };

  for (const { source, merchant } of rows) {
    if (source.scrapingMethod === "manual") {
      summary.skippedManual++;
      continue;
    }

    summary.sourcesChecked++;
    try {
      const result = await fetchDealSource({ url: source.sourceUrl, previousHash: source.contentHash });

      if (result.changed) {
        await db.insert(dealRawContent).values({
          merchantId: merchant.id,
          merchantSourceId: source.id,
          universityId,
          sourceUrl: source.sourceUrl,
          rawText: result.normalizedText,
          contentHash: result.contentHash,
          processingStatus: "pending",
        });
        summary.changed++;
      } else {
        summary.unchanged++;
      }

      await db
        .update(merchantSources)
        .set({
          lastCheckedAt: new Date(),
          lastSuccessfulCheckAt: new Date(),
          ...(result.changed ? { lastChangedAt: new Date() } : {}),
          contentHash: result.contentHash,
          updatedAt: new Date(),
        })
        .where(eq(merchantSources.id, source.id));
    } catch (err) {
      summary.failed++;
      await db
        .update(merchantSources)
        .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
        .where(eq(merchantSources.id, source.id));
      await log(
        universityId,
        "error",
        "deals.ingestion",
        `Merchant source for "${merchant.name}" (${source.sourceUrl}) failed: ${(err as Error).message}`,
        { merchantSourceId: source.id },
      );
    }
  }

  return summary;
}
