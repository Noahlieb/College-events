import { PhantomBusterClient } from "@college-events/ingestion";
import { importPhantomBusterResults, type PhantomBusterImportSummary } from "./phantombuster.js";
import { log } from "../lib/log.js";

/**
 * Automates the PhantomBuster leg end-to-end: launches an already-configured
 * agent, waits for it to finish, and imports the results — replacing the
 * manual "run the Phantom, download JSON, hand it to the CLI" workflow.
 * The agent itself (which Instagram accounts it watches, its login
 * session) is still set up once by a human in PhantomBuster's own UI —
 * see README's PhantomBuster section for why that boundary exists.
 */
export async function runLivePhantomBusterIngest(
  schoolId: string,
  agentId: string,
  options: { apiKey?: string; maxItemsPerAccount?: number } = {},
): Promise<PhantomBusterImportSummary> {
  const apiKey = options.apiKey ?? process.env.PHANTOMBUSTER_API_KEY;
  if (!apiKey) {
    throw new Error("PHANTOMBUSTER_API_KEY is not set — required for live PhantomBuster ingestion.");
  }

  const client = new PhantomBusterClient({ apiKey });
  await log(schoolId, "info", "ingestion.phantombuster_live", `Launching PhantomBuster agent ${agentId}...`);

  const posts = await client.runAgentAndGetResults(agentId, { timeoutMs: 10 * 60_000 });
  await log(schoolId, "info", "ingestion.phantombuster_live", `Agent ${agentId} finished with ${posts.length} row(s).`);

  return importPhantomBusterResults(schoolId, posts, options.maxItemsPerAccount);
}
