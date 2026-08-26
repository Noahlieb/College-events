import "./env.js";
import fs from "node:fs/promises";
import { pool } from "@college-events/db";
import { resolveSchoolId } from "./lib/resolve-school.js";
import { ingestSchoolSources } from "./pipeline/ingest.js";
import { sourceReport } from "./pipeline/source-report.js";
import { tickScheduler } from "./pipeline/crawl-scheduler.js";
import { discoverUniversitySources } from "./pipeline/discover.js";
import { resolveArtworkForSchool } from "./pipeline/resolve-artwork.js";
import { runDiscoveryMissProbe } from "./pipeline/discovery-miss-probe.js";
import { hashPendingAssets } from "./pipeline/hash-assets.js";
import { processSchoolRawContent } from "./pipeline/process.js";
import { selectWeeklyPosts } from "./pipeline/select-posts.js";
import { renderPost } from "./pipeline/render.js";
import { renderAllPosts } from "./pipeline/render-all.js";
import { listAssets } from "./pipeline/list-assets.js";
import { approvePost, rejectPost } from "./pipeline/approve.js";
import { schedulePost } from "./pipeline/schedule.js";
import { importPhantomBusterResults } from "./pipeline/phantombuster.js";
import { runLivePhantomBusterIngest } from "./pipeline/phantombuster-live.js";
import { submitManualEvent } from "./pipeline/manual.js";
import { importCsvEvents } from "./pipeline/csv-import.js";
import { backfillLanes } from "./pipeline/backfill-lanes.js";
import { shortenExistingDescriptions } from "./pipeline/shorten-descriptions.js";
import { runDemo } from "./demo.js";
import { eq } from "drizzle-orm";
import { db, sources } from "@college-events/db";

const USAGE = `
College Events worker CLI

Usage: pnpm --filter @college-events/worker start <command> [args]

Commands:
  ingest [school]                          Crawl every active source through its adapter and write
                                            what they find straight into raw_content
  discover-misses [school]                 Run broad "what's actually happening" queries and check
                                            them against events our registered sources already
                                            caught. Repeated misses from one place become a reviewable
                                            source candidate. Meant to run occasionally (e.g. weekly),
                                            not on every daily pipeline run.
  hash-assets [school]                     Perceptually hash asset candidates that don't have one
                                            yet, so copies of one flyer are recognised as copies.
                                            Isolated from process/ingest because it needs sharp,
                                            which cannot be bundled into the dashboard's build.
  resolve-artwork [school]                 Bring every event with completed asset discovery to a
                                            decided artwork state: select the best real image, or
                                            generate one when none exists. Idempotent — re-running
                                            costs nothing for events already resolved.
  discover [school]                        Search this university's ecosystem, fingerprint what
                                            comes back, and store reviewable source candidates
  crawl [school]                           Enqueue every source whose next run is due and work the
                                            queue with bounded concurrency; failures stay contained
                                            to their own job
  source-report [school]                   Markdown table of every source's adapter, health, last
                                            crawl and last event — what the daily run posts
  ingest:phantombuster <school> <file>     Import a PhantomBuster Instagram scrape JSON file
  ingest:phantombuster-live [school] [agentId]
                                            Launch a PhantomBuster agent via API, wait for it,
                                            and import its results automatically (no manual file)
  process [school]                         Run AI extraction/scoring/dedup over pending raw_content
  select-posts [school]                    Build/refresh posts for this week + the next 3 (Mon campus,
                                            Thu nightlife); safe to re-run, skips approved posts
  backfill-lanes [school] [--dry-run]      Bring an existing DB in line with the current lane rules:
                                            prune dead schedule slots, pin single-purpose sources to
                                            their category, recategorize + rescore their past events
  shorten-descriptions [school]            One-time backfill: AI-shorten any existing event's
                                            description that's still the original long raw text
                                            (auto-shortening only applies going forward at
                                            creation/merge time otherwise)
  render <postId>                          Render a post's branded carousel
  render-all [school]                      Re-render every current/future post that can still change
                                            (skips published posts and past weeks)
  list-assets [school]                     Print every post's rendered assets and their storage URLs
                                            (shows which are content-addressed vs. stale paths)
  approve <postId> <approvedBy>            Approve a post for scheduling
  reject <postId> <reason> <rejectedBy>    Reject a post
  schedule <postId>                        Send an approved post to the scheduler (Buffer/mock)
  manual-entry <school> <file>             Submit a manually-entered event from a JSON file
  import-csv <school> <file> [submittedBy] [--source="Name"]
                                            Bulk-import events from a CSV (Date, Time, Category,
                                            Event, Presenter/Team, Venue, Notes, Image URL, Link).
                                            An operator tool, not an automated path: sources are
                                            crawled by 'ingest'. Use this for one-off backfills and
                                            hand-curated lists.
                                            --source attributes rows to a specific manual_submission
                                            source by exact name (must already exist); omit to use
                                            the school's oldest manual_submission source.
  demo [school]                            Run the full pipeline end-to-end (defaults to FAU)

[school] defaults to "FAU" and refers to schools.short_name.
`;

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "ingest": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const summary = await ingestSchoolSources(schoolId);
      // Print the per-source breakdown, not just the totals: a run where
      // one platform declined access and the rest worked is a different
      // situation from a run where everything worked, and the totals alone
      // cannot tell them apart.
      for (const run of summary.runs) {
        const detail = run.reason ? ` — ${run.reason}` : "";
        console.log(
          `  ${run.health.padEnd(8)} ${run.sourceName} [${run.adapterType ?? "no adapter"}] ` +
            `+${run.discovered} new / ${run.itemsSeen} seen${detail}`,
        );
      }
      console.log(summary);
      break;
    }
    case "crawl": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const summary = await tickScheduler(schoolId);
      for (const run of summary.results) {
        console.log(
          `  ${run.health.padEnd(8)} ${run.sourceName} [${run.adapterType ?? "no adapter"}] ` +
            `+${run.discovered} new / ${run.itemsSeen} seen${run.reason ? ` — ${run.reason}` : ""}`,
        );
      }
      console.log(summary);
      break;
    }
    case "discover": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const summary = await discoverUniversitySources(schoolId);
      if (!summary.configured) {
        console.log(
          "No search provider configured — set DISCOVERY_PROVIDER (brave|google_cse) and its key.\n" +
            "Discovery is a safety net over the sources you already have, so this is not an error.",
        );
      }
      console.log(summary);
      break;
    }
    case "hash-assets": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const summary = await hashPendingAssets(schoolId);
      console.log(summary);
      break;
    }
    case "resolve-artwork": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const force = args.includes("--force");
      const summary = await resolveArtworkForSchool(schoolId, force ? { limit: 200 } : {});
      for (const { eventId, outcome } of summary.outcomes) {
        console.log(`  ${outcome.action.padEnd(24)} ${eventId} — ${outcome.reason}`);
      }
      console.log({
        inspected: summary.inspected,
        selectedOfficial: summary.selectedOfficial,
        generated: summary.generated,
        alreadyGenerated: summary.alreadyGenerated,
        skipped: summary.skipped,
      });
      break;
    }
    case "discover-misses": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const summary = await runDiscoveryMissProbe(schoolId);
      if (!summary.configured) {
        console.log("No search provider configured — set DISCOVERY_PROVIDER (brave|google_cse) and its key.");
      }
      console.log(summary);
      break;
    }
    case "source-report": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      console.log(await sourceReport(schoolId));
      break;
    }
    case "ingest:phantombuster": {
      const [school, file] = args;
      if (!school || !file) throw new Error("Usage: ingest:phantombuster <school> <file>");
      const schoolId = await resolveSchoolId(school);
      const posts = JSON.parse(await fs.readFile(file, "utf-8"));
      const summary = await importPhantomBusterResults(schoolId, posts);
      console.log(summary);
      break;
    }
    case "ingest:phantombuster-live": {
      const [school, agentIdArg] = args;
      const schoolId = await resolveSchoolId(school ?? "FAU");
      const agentId = agentIdArg ?? process.env.PHANTOMBUSTER_AGENT_ID;
      if (!agentId) throw new Error("Usage: ingest:phantombuster-live [school] <agentId>  (or set PHANTOMBUSTER_AGENT_ID)");
      const summary = await runLivePhantomBusterIngest(schoolId, agentId);
      console.log(summary);
      break;
    }
    case "process": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const summary = await processSchoolRawContent(schoolId);
      console.log(summary);
      break;
    }
    case "select-posts": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const summary = await selectWeeklyPosts(schoolId);
      console.table(summary);
      break;
    }
    case "backfill-lanes": {
      const dryRun = args.includes("--dry-run");
      const schoolId = await resolveSchoolId(args.find((a) => !a.startsWith("--")) ?? "FAU");
      const summary = await backfillLanes(schoolId, dryRun);
      console.log(dryRun ? "DRY RUN — nothing written:" : "Applied:");
      console.log(summary);
      break;
    }
    case "shorten-descriptions": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const summary = await shortenExistingDescriptions(schoolId);
      console.log(summary);
      break;
    }
    case "render-all": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      const results = await renderAllPosts(schoolId);
      console.table(results);
      const failed = results.filter((r) => r.error).length;
      if (failed > 0) {
        console.error(`${failed} of ${results.length} post(s) failed to render.`);
        process.exitCode = 1;
      }
      break;
    }
    case "list-assets": {
      const schoolId = await resolveSchoolId(args[0] ?? "FAU");
      await listAssets(schoolId);
      break;
    }
    case "render": {
      const [postId] = args;
      if (!postId) throw new Error("Usage: render <postId>");
      const result = await renderPost(postId);
      console.log(result);
      break;
    }
    case "approve": {
      const [postId, approvedBy] = args;
      if (!postId || !approvedBy) throw new Error("Usage: approve <postId> <approvedBy>");
      await approvePost(postId, approvedBy);
      console.log(`Post ${postId} approved.`);
      break;
    }
    case "reject": {
      const [postId, reason, rejectedBy] = args;
      if (!postId || !reason || !rejectedBy) throw new Error("Usage: reject <postId> <reason> <rejectedBy>");
      await rejectPost(postId, reason, rejectedBy);
      console.log(`Post ${postId} rejected.`);
      break;
    }
    case "schedule": {
      const [postId] = args;
      if (!postId) throw new Error("Usage: schedule <postId>");
      const result = await schedulePost(postId);
      console.log(result);
      break;
    }
    case "manual-entry": {
      const [school, file] = args;
      if (!school || !file) throw new Error("Usage: manual-entry <school> <file>");
      const schoolId = await resolveSchoolId(school);
      const [manualSource] = await db.select().from(sources).where(eq(sources.sourceType, "manual_submission")).limit(1);
      if (!manualSource) throw new Error("No manual_submission source configured for this school");
      const input = JSON.parse(await fs.readFile(file, "utf-8"));
      const result = await submitManualEvent(schoolId, manualSource.id, input);
      console.log(result);
      break;
    }
    case "import-csv": {
      const positional: string[] = [];
      let sourceName: string | undefined;
      for (const arg of args) {
        if (arg.startsWith("--source=")) sourceName = arg.slice("--source=".length);
        else positional.push(arg);
      }
      const [school, file, submittedBy] = positional;
      if (!school || !file) {
        throw new Error('Usage: import-csv <school> <file> [submittedBy] [--source="Source Name"]');
      }
      const schoolId = await resolveSchoolId(school);
      const csvText = await fs.readFile(file, "utf-8");
      const summary = await importCsvEvents(schoolId, csvText, submittedBy, sourceName);
      console.log(JSON.stringify(summary));
      break;
    }
    case "demo": {
      await runDemo(args[0] ?? "FAU");
      break;
    }
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
