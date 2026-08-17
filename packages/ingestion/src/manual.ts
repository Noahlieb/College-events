import type { EventCategory } from "@college-events/core";
import type { DiscoveredItem } from "./types.js";

export interface ManualEventInput {
  name: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:mm
  endTime?: string | null;
  venue: string | null;
  price: string | null;
  description: string | null;
  flyerUrl: string | null;
  sourceUrl: string | null;
  category: EventCategory;
  submittedBy: string;
}

/**
 * Shapes a manually-entered event (spec §33) into the same DiscoveredItem
 * contract every other adapter produces, so it lands in raw_content and
 * flows through the identical downstream pipeline — scoring, dedup,
 * rendering, selection — rather than a bespoke manual-entry path. The
 * caller (apps/worker) still skips the AI *extraction* step for these,
 * since the fields are already structured, but everything after that is
 * shared code.
 */
export function buildManualRawContent(input: ManualEventInput): DiscoveredItem {
  const textParts = [
    input.name,
    `Date: ${input.date}`,
    input.startTime ? `Start: ${input.startTime}` : null,
    input.venue ? `Venue: ${input.venue}` : null,
    input.price ? `Price: ${input.price}` : null,
    input.description,
  ].filter(Boolean);

  return {
    externalId: `manual:${input.submittedBy}:${input.name}:${input.date}:${Date.now()}`,
    sourceUrl: input.sourceUrl,
    rawText: textParts.join("\n"),
    mediaUrl: input.flyerUrl,
    publishedAt: new Date().toISOString(),
    rawMetadata: {
      manual: true,
      submittedBy: input.submittedBy,
      structured: {
        name: input.name,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime ?? null,
        venue: input.venue,
        price: input.price,
        category: input.category,
      },
    },
  };
}
