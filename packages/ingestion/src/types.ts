import type { SourceType } from "@college-events/core";

/** One newly-discovered item from a source, ready to become a raw_content row. */
export interface DiscoveredItem {
  externalId: string;
  sourceUrl: string | null;
  rawText: string | null;
  mediaUrl: string | null;
  publishedAt: string | null; // ISO
  rawMetadata?: Record<string, unknown>;
}

export interface FetchContext {
  source: {
    id: string;
    url: string | null;
    instagramHandle: string | null;
    metadata: Record<string, unknown>;
  };
  lastSuccessfulCheckAt: Date | null;
  /** Cap how many items to inspect per run — spec §8: we only care whether an
   * account posted something NEW, so there's no need to walk deep history. */
  maxItems?: number;
  /** Injectable for testing / for environments with a custom fetch (proxying, auth headers). */
  fetchImpl?: typeof fetch;
}

export interface SourceAdapter {
  readonly supportedTypes: SourceType[];
  fetchNew(ctx: FetchContext): Promise<DiscoveredItem[]>;
}

export class IngestionError extends Error {
  constructor(
    message: string,
    public readonly sourceId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}
