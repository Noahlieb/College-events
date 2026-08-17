import type {
  PostStatusResult,
  ScheduleResult,
  SchedulePostInput,
  SchedulerProvider,
} from "../types.js";
import { SchedulerError } from "../types.js";

export interface BufferProviderOptions {
  accessToken: string;
  /** Base URL override, mainly for tests. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface BufferCreateUpdateResponse {
  success?: boolean;
  message?: string;
  updates?: { id: string; status: string; scheduled_at?: number }[];
}

/**
 * Buffer (buffer.com) scheduler integration, using Buffer's REST "Publish"
 * API. NOTE for whoever wires up live credentials: Buffer's exact request
 * shape for multi-image Instagram carousels can differ by plan/API version
 * (their newer Create Post API supersedes the legacy `/1/updates/create`
 * endpoint used here). Validate this against a real Buffer app + connected
 * Instagram Business profile before going live, and adjust the request body
 * in `schedulePost` accordingly — the SchedulerProvider interface and every
 * caller above it will not need to change.
 */
export class BufferSchedulerProvider implements SchedulerProvider {
  readonly name = "buffer";
  private accessToken: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(options: BufferProviderOptions) {
    this.accessToken = options.accessToken;
    this.baseUrl = options.baseUrl ?? "https://api.bufferapp.com/1";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async schedulePost(input: SchedulePostInput): Promise<ScheduleResult> {
    const body = new URLSearchParams();
    body.set("access_token", this.accessToken);
    body.append("profile_ids[]", input.profileId);
    body.set("text", input.caption);
    body.set("scheduled_at", String(Math.floor(new Date(input.scheduledAt).getTime() / 1000)));
    body.set("now", "false");
    // Legacy Buffer media field takes one photo; carousels need Buffer's
    // multi-photo/"media.photo" array support on newer API versions — see
    // class-level note above.
    if (input.imageUrls[0]) {
      body.set("media[photo]", input.imageUrls[0]);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/updates/create.json`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new SchedulerError(`Buffer request failed: ${(err as Error).message}`, this.name, err);
    }

    const json = (await response.json()) as BufferCreateUpdateResponse;
    if (!response.ok || json.success === false || !json.updates?.[0]) {
      throw new SchedulerError(`Buffer rejected the post: ${json.message ?? response.statusText}`, this.name, json);
    }

    const update = json.updates[0]!;
    return {
      schedulerPostId: update.id,
      status: "scheduled",
      scheduledAt: input.scheduledAt,
      raw: json,
    };
  }

  async getPostStatus(schedulerPostId: string): Promise<PostStatusResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/updates/${schedulerPostId}.json?access_token=${encodeURIComponent(this.accessToken)}`,
      );
    } catch (err) {
      throw new SchedulerError(`Buffer status check failed: ${(err as Error).message}`, this.name, err);
    }
    const json = (await response.json()) as { status?: string; sent?: boolean };
    if (!response.ok) throw new SchedulerError(`Buffer status check failed: HTTP ${response.status}`, this.name, json);
    const status = json.sent ? "published" : (json.status as PostStatusResult["status"]) ?? "unknown";
    return { status, raw: json };
  }

  async cancelPost(schedulerPostId: string): Promise<void> {
    const body = new URLSearchParams({ access_token: this.accessToken });
    const response = await this.fetchImpl(`${this.baseUrl}/updates/${schedulerPostId}/destroy.json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new SchedulerError(`Buffer cancel failed: HTTP ${response.status}`, this.name);
    }
  }
}
