export interface SchedulePostInput {
  /** Scheduler-side profile/channel identifier (e.g. Buffer profile ID for
   * the school's Instagram account). Never the raw Instagram credentials. */
  profileId: string;
  /** Publicly-fetchable URLs for each carousel slide, in display order.
   * Schedulers work off hosted media, not raw bytes — rendered_assets rows
   * already carry a storage_url for exactly this reason. */
  imageUrls: string[];
  caption: string;
  scheduledAt: string; // ISO timestamp
  /** Our internal post id, threaded through for correlation in logs/webhooks. */
  externalRef: string;
}

export type SchedulerPostStatus = "scheduled" | "published" | "failed" | "unknown";

export interface ScheduleResult {
  schedulerPostId: string;
  status: SchedulerPostStatus;
  scheduledAt: string;
  raw?: unknown;
}

export interface PostStatusResult {
  status: SchedulerPostStatus;
  raw?: unknown;
}

/**
 * Provider-agnostic scheduling surface (spec §6/§26). apps/worker and the
 * dashboard depend only on this interface, never on a Buffer SDK/API
 * directly, so swapping to another scheduler later is a config change.
 */
export interface SchedulerProvider {
  readonly name: string;
  schedulePost(input: SchedulePostInput): Promise<ScheduleResult>;
  getPostStatus(schedulerPostId: string): Promise<PostStatusResult>;
  cancelPost(schedulerPostId: string): Promise<void>;
}

export class SchedulerError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SchedulerError";
  }
}
