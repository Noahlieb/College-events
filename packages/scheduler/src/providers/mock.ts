import type {
  PostStatusResult,
  ScheduleResult,
  SchedulePostInput,
  SchedulerProvider,
} from "../types.js";

/**
 * In-memory scheduler for local dev/demo — lets posts flow all the way to
 * "SCHEDULED" without a live Buffer account (spec §25/§47). Not persisted
 * across process restarts; that's fine, since apps/worker also stores the
 * returned schedulerPostId on the posts row for its own record.
 */
export class MockSchedulerProvider implements SchedulerProvider {
  readonly name = "mock";
  private posts = new Map<string, ScheduleResult>();

  async schedulePost(input: SchedulePostInput): Promise<ScheduleResult> {
    const id = `mock-${input.externalRef}-${Date.now()}`;
    const result: ScheduleResult = { schedulerPostId: id, status: "scheduled", scheduledAt: input.scheduledAt };
    this.posts.set(id, result);
    console.log(
      `[scheduler:mock] scheduled "${input.caption.split("\n")[0]}" (${input.imageUrls.length} slides) for profile ${input.profileId} at ${input.scheduledAt} -> ${id}`,
    );
    return result;
  }

  async getPostStatus(schedulerPostId: string): Promise<PostStatusResult> {
    const post = this.posts.get(schedulerPostId);
    return { status: post?.status ?? "unknown" };
  }

  async cancelPost(schedulerPostId: string): Promise<void> {
    this.posts.delete(schedulerPostId);
  }
}
