import { and, eq, sql } from "drizzle-orm";
import { db, dealContentPostDeals, dealContentPosts, deals, merchants } from "@college-events/db";
import { resolveSchoolId } from "./lib/resolve-school.js";
import { ingestUniversityMerchantSources } from "./deals-pipeline/ingest-merchant-sources.js";
import { processUniversityDeals } from "./deals-pipeline/process-deals.js";
import { generateWeeklyContentQueue } from "./deals-pipeline/generate-content-queue.js";

const divider = "─".repeat(64);

/**
 * End-to-end deals demo run (mirrors apps/worker/src/demo.ts for Events):
 * change detection over seeded merchant sources -> AI extraction ->
 * fingerprint/dedup -> freshness -> quality score -> content eligibility ->
 * weekly content queue assembly, all against real data seeded by
 * `pnpm db:seed:deals`. Nothing is auto-approved or posted.
 */
export async function runDealsDemo(universityShortName = "UCF"): Promise<void> {
  const universityId = await resolveSchoolId(universityShortName);

  console.log(divider);
  console.log(`College Deals demo run — ${universityShortName}`);
  console.log(divider);

  console.log("\n[1/4] Change detection over merchant sources...");
  const ingestSummary = await ingestUniversityMerchantSources(universityId);
  console.log(`  sources checked: ${ingestSummary.sourcesChecked}`);
  console.log(`  changed (queued for extraction): ${ingestSummary.changed}`);
  console.log(`  unchanged (skipped, no LLM call): ${ingestSummary.unchanged}`);
  console.log(`  skipped (manual sources): ${ingestSummary.skippedManual}`);
  console.log(`  failed: ${ingestSummary.failed}`);

  console.log("\n[2/4] AI extraction -> dedup -> scoring -> eligibility...");
  const processSummary = await processUniversityDeals(universityId);
  console.log(`  inspected: ${processSummary.inspected}`);
  console.log(`  new deals created: ${processSummary.created}`);
  console.log(`  updated (terms changed): ${processSummary.updated}`);
  console.log(`  recurring deals reactivated: ${processSummary.recurringReactivated}`);
  console.log(`  duplicates skipped: ${processSummary.duplicatesSkipped}`);
  console.log(`  rejected (not a deal): ${processSummary.rejectedNotADeal}`);
  console.log(`  errored: ${processSummary.errored}`);

  console.log("\n[3/4] Building the proposed weekly content queue...");
  const queueResults = await generateWeeklyContentQueue(universityId);
  for (const r of queueResults) {
    console.log(`  ${r.slot.padEnd(16)} ${r.scheduledDate}  deals=${r.dealCount}  status=${r.status}`);
  }
  for (const r of queueResults) {
    if (r.dealCount === 0) continue;
    const links = await db
      .select({ position: dealContentPostDeals.position, deal: deals, merchant: merchants })
      .from(dealContentPostDeals)
      .innerJoin(deals, eq(dealContentPostDeals.dealId, deals.id))
      .innerJoin(merchants, eq(deals.merchantId, merchants.id))
      .where(eq(dealContentPostDeals.postId, r.postId));
    for (const l of links.sort((a, b) => a.position - b.position)) {
      console.log(`      - ${l.merchant.name}: ${l.deal.title} (score ${l.deal.qualityScore})`);
    }
  }

  console.log("\n[4/4] Deal inventory summary...");
  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .where(eq(deals.universityId, universityId));
  const byEligibility = await db
    .select({ contentEligibility: deals.contentEligibility, count: sql<number>`count(*)::int` })
    .from(deals)
    .where(eq(deals.universityId, universityId))
    .groupBy(deals.contentEligibility);
  const byFreshness = await db
    .select({ freshnessStatus: deals.freshnessStatus, count: sql<number>`count(*)::int` })
    .from(deals)
    .where(eq(deals.universityId, universityId))
    .groupBy(deals.freshnessStatus);
  const needsReview = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.universityId, universityId), eq(deals.verificationStatus, "needs_review")));

  console.log(`  ${totalRow?.total ?? 0} total deals`);
  console.log(`  by content eligibility: ${byEligibility.map((r) => `${r.contentEligibility}=${r.count}`).join(", ")}`);
  console.log(`  by freshness: ${byFreshness.map((r) => `${r.freshnessStatus}=${r.count}`).join(", ")}`);
  console.log(`  needs verification: ${needsReview[0]?.count ?? 0}`);

  const draftPosts = await db.select().from(dealContentPosts).where(eq(dealContentPosts.universityId, universityId));
  console.log(`  ${draftPosts.length} content_posts rows sitting in the human approval queue (${draftPosts.map((p) => p.status).join(", ") || "none"})`);

  console.log(`\n${divider}\nDeals demo complete. Review the queue on /deals/queue before approving anything.\n${divider}`);
}
