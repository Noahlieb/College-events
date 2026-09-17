"use server";

import { revalidatePath } from "next/cache";
// Deep imports into each deals-pipeline file rather than the
// @college-events/worker barrel — same reasoning as actions.ts: the
// barrel's index.ts also re-exports render.js (sharp), which isn't
// reliably resolvable in Vercel's deployed function output.
import { ingestUniversityMerchantSources } from "@college-events/worker/dist/deals-pipeline/ingest-merchant-sources.js";
import { processUniversityDeals } from "@college-events/worker/dist/deals-pipeline/process-deals.js";
import { generateWeeklyContentQueue } from "@college-events/worker/dist/deals-pipeline/generate-content-queue.js";
import { approveDealContentPost, rejectDealContentPost } from "@college-events/worker/dist/deals-pipeline/approve.js";
import { getCurrentUniversity } from "./current-university";

export async function runDealsIngestAction() {
  const university = await getCurrentUniversity();
  await ingestUniversityMerchantSources(university.id);
  revalidatePath("/deals");
}

export async function runDealsProcessAction() {
  const university = await getCurrentUniversity();
  await processUniversityDeals(university.id);
  revalidatePath("/deals");
  revalidatePath("/deals/queue");
}

export async function runDealsQueueAction() {
  const university = await getCurrentUniversity();
  await generateWeeklyContentQueue(university.id);
  revalidatePath("/deals/queue");
}

export async function approveDealPostAction(postId: string) {
  await approveDealContentPost(postId, "dashboard-admin");
  revalidatePath("/deals/queue");
}

export async function rejectDealPostAction(postId: string, formData: FormData) {
  const reason = String(formData.get("reason") ?? "") || "rejected from dashboard";
  await rejectDealContentPost(postId, reason, "dashboard-admin");
  revalidatePath("/deals/queue");
}
