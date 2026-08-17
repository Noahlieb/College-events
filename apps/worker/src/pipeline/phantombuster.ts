import { and, eq } from "drizzle-orm";
import { db, rawContent, sources } from "@college-events/db";
import { importPhantomBusterPosts, type PhantomBusterPost } from "@college-events/ingestion";
import { log } from "../lib/log.js";

export interface PhantomBusterImportSummary {
  inserted: number;
  duplicatesSkipped: number;
  unmatchedAccounts: string[];
}

/**
 * Imports a PhantomBuster Instagram scrape result (spec §8). PhantomBuster
 * is purely the collection mechanism — this just maps each post to the
 * matching `sources` row (by instagram_handle) and inserts raw_content as
 * `pending`; all intelligence happens in the downstream `process` step.
 */
export async function importPhantomBusterResults(
  schoolId: string,
  posts: PhantomBusterPost[],
  maxItemsPerAccount = 5,
): Promise<PhantomBusterImportSummary> {
  const { items } = importPhantomBusterPosts(posts, { maxItemsPerAccount });

  const igSources = await db
    .select()
    .from(sources)
    .where(and(eq(sources.schoolId, schoolId), eq(sources.sourceType, "instagram")));
  const sourceByHandle = new Map(igSources.map((s) => [s.instagramHandle?.toLowerCase(), s]));

  const summary: PhantomBusterImportSummary = { inserted: 0, duplicatesSkipped: 0, unmatchedAccounts: [] };

  for (const item of items) {
    const username = (item.rawMetadata?.username as string | undefined)?.toLowerCase();
    const source = username ? sourceByHandle.get(username) : undefined;
    if (!source) {
      if (username && !summary.unmatchedAccounts.includes(username)) summary.unmatchedAccounts.push(username);
      continue;
    }

    const inserted = await db
      .insert(rawContent)
      .values({
        schoolId,
        sourceId: source.id,
        externalId: item.externalId,
        sourceUrl: item.sourceUrl,
        rawText: item.rawText,
        mediaUrl: item.mediaUrl,
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        processingStatus: "pending",
        rawMetadata: item.rawMetadata ?? {},
      })
      .onConflictDoNothing({ target: [rawContent.sourceId, rawContent.externalId] })
      .returning({ id: rawContent.id });

    if (inserted.length > 0) summary.inserted++;
    else summary.duplicatesSkipped++;
  }

  if (summary.unmatchedAccounts.length > 0) {
    await log(
      schoolId,
      "warn",
      "ingestion.phantombuster",
      `${summary.unmatchedAccounts.length} scraped account(s) have no matching Instagram source row: ${summary.unmatchedAccounts.join(", ")}`,
    );
  }

  return summary;
}
