import { eq, sql } from "drizzle-orm";
import { db, events, posts } from "@college-events/db";
import { resolveSchoolId } from "./lib/resolve-school.js";
import { processSchoolRawContent } from "./pipeline/process.js";
import { selectWeeklyPosts } from "./pipeline/select-posts.js";
import { renderPost } from "./pipeline/render.js";
import { approvePost } from "./pipeline/approve.js";
import { schedulePost } from "./pipeline/schedule.js";

const divider = "─".repeat(64);

/**
 * End-to-end demo run (spec §52): AI extraction over the seeded pending
 * raw_content -> scoring/dedup/verification -> weekly post selection ->
 * branded carousel rendering -> caption generation -> (for one post) the
 * human-approval + scheduler leg, so every stage in the pipeline diagram
 * in spec §43 actually runs against real data in this repo.
 */
export async function runDemo(schoolShortName = "FAU"): Promise<void> {
  const schoolId = await resolveSchoolId(schoolShortName);

  console.log(divider);
  console.log(`College Events demo run — ${schoolShortName}`);
  console.log(divider);

  console.log("\n[1/5] AI extraction pipeline over pending raw_content...");
  const processSummary = await processSchoolRawContent(schoolId);
  console.log(`  inspected: ${processSummary.inspected}`);
  console.log(`  created new events: ${processSummary.created}`);
  console.log(`  merged into existing events: ${processSummary.merged}`);
  console.log(`  rejected (not an event): ${processSummary.rejectedNotAnEvent}`);
  console.log(`  rejected (date parse error): ${processSummary.rejectedDateParseError}`);
  console.log(`  errored: ${processSummary.errored}`);

  console.log("\n[2/5] Selecting this week's posts (Monday/Midweek/Thursday)...");
  const postResults = await selectWeeklyPosts(schoolId);
  for (const p of postResults) {
    console.log(`  ${p.postType.padEnd(20)} ${p.scheduledDate}  events=${p.eventCount}  status=${p.status}`);
  }

  console.log("\n[3/5] Rendering branded carousels...");
  for (const p of postResults) {
    if (p.status.includes("locked")) {
      console.log(`  ${p.postType}: skipped (locked, already approved/scheduled)`);
      continue;
    }
    if (p.eventCount === 0) {
      console.log(`  ${p.postType}: skipped (no eligible events this week)`);
      continue;
    }
    const rendered = await renderPost(p.postId);
    console.log(`  ${p.postType}: rendered ${rendered.slideCount} slides`);
    for (const url of rendered.assetUrls) console.log(`    - ${url}`);
  }

  console.log("\n[4/5] Demonstrating the approval -> scheduler leg on the Monday post...");
  const mondayPost = postResults.find((p) => p.postType === "monday_campus" && p.eventCount > 0);
  if (mondayPost && !mondayPost.status.includes("locked")) {
    const [freshPost] = await db.select().from(posts).where(eq(posts.id, mondayPost.postId)).limit(1);
    console.log(`  Monday post caption:\n${indent(freshPost?.caption ?? "(none)")}`);
    await approvePost(mondayPost.postId, "demo-script");
    const result = await schedulePost(mondayPost.postId);
    console.log(
      `  approved and scheduled via mock scheduler -> ${result.schedulerPostId} (${result.status}) at ${result.scheduledAt}`,
    );
  } else {
    console.log("  skipped (no eligible Monday post this run)");
  }

  console.log("\n[5/5] Event inventory summary...");
  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.schoolId, schoolId));
  const byStatus = await db
    .select({ status: events.status, count: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.schoolId, schoolId))
    .groupBy(events.status);
  const byCategory = await db
    .select({ category: events.category, count: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.schoolId, schoolId))
    .groupBy(events.category);

  console.log(`  ${totalRow?.total ?? 0} total events`);
  console.log(`  by status: ${byStatus.map((r) => `${r.status}=${r.count}`).join(", ")}`);
  console.log(`  by category: ${byCategory.map((r) => `${r.category}=${r.count}`).join(", ")}`);

  console.log(`\n${divider}\nDemo complete.\n${divider}`);
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}
