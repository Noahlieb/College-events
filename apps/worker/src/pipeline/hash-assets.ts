import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { assetCandidates, db } from "@college-events/db";
import { inspectImage } from "@college-events/render";
import { refreshCanonicalAsset } from "./event-assets.js";

/**
 * Downloads and perceptually hashes asset candidates that don't have a
 * hash yet, then re-runs canonical selection for the events affected.
 *
 * Kept as its own worker-only step, deliberately not called from
 * `event-assets.ts`. That module sits on the import path `process.ts`
 * uses, which the dashboard reaches through a deep import chosen
 * specifically to keep sharp — a native binary Next.js cannot bundle into
 * a serverless function — out of the dashboard's build. This file imports
 * `@college-events/render` (and therefore sharp) freely, because nothing
 * in `apps/dashboard` ever imports it: only the worker CLI does, and the
 * worker is a plain Node process, not a Next.js function.
 */

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

async function defaultFetchImage(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_IMAGE_BYTES) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.byteLength > MAX_IMAGE_BYTES ? null : buffer;
  } catch {
    return null;
  }
}

export interface HashAssetsSummary {
  inspected: number;
  hashed: number;
  unreadable: number;
  eventsRefreshed: number;
}

export async function hashPendingAssets(
  schoolId: string,
  options: { limit?: number; fetchImage?: (url: string) => Promise<Buffer | null> } = {},
): Promise<HashAssetsSummary> {
  const fetchImage = options.fetchImage ?? defaultFetchImage;

  const pending = await db
    .select()
    .from(assetCandidates)
    .where(
      and(
        eq(assetCandidates.schoolId, schoolId),
        isNull(assetCandidates.perceptualHash),
        isNotNull(assetCandidates.sourceUrl),
        // Generated assets are hashed at creation time from bytes already
        // in hand; nothing to fetch here.
        eq(assetCandidates.isAiGenerated, false),
      ),
    )
    .limit(options.limit ?? 200);

  const summary: HashAssetsSummary = { inspected: 0, hashed: 0, unreadable: 0, eventsRefreshed: 0 };
  const affectedEvents = new Set<string>();

  for (const candidate of pending) {
    summary.inspected++;
    const bytes = await fetchImage(candidate.sourceUrl);
    if (!bytes) {
      summary.unreadable++;
      continue;
    }

    const facts = await inspectImage(bytes).catch(() => null);
    if (!facts?.perceptualHash) {
      summary.unreadable++;
      continue;
    }

    await db
      .update(assetCandidates)
      .set({
        perceptualHash: facts.perceptualHash,
        width: facts.width ?? candidate.width,
        height: facts.height ?? candidate.height,
        mime: facts.mime ?? candidate.mime,
        bytes: facts.bytes,
      })
      .where(eq(assetCandidates.id, candidate.id));

    summary.hashed++;
    affectedEvents.add(candidate.eventId);
  }

  // A hash can change which copy of a flyer wins, or reveal that two
  // "different" candidates are the same picture — re-select for every
  // event a newly-hashed candidate belongs to.
  for (const eventId of affectedEvents) {
    await refreshCanonicalAsset(eventId);
    summary.eventsRefreshed++;
  }

  return summary;
}
