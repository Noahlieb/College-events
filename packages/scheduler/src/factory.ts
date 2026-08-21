import { MockSchedulerProvider } from "./providers/mock.js";
import { BufferSchedulerProvider } from "./providers/buffer.js";
import type { SchedulerProvider } from "./types.js";

export interface CreateSchedulerOptions {
  provider?: "buffer" | "mock";
  bufferAccessToken?: string;
}

/** Central factory, mirroring createAIProvider(): env-driven, and falls
 * back to the mock provider whenever credentials are missing so scheduling
 * never hard-blocks the pipeline (spec §25/§47). */
export function createSchedulerProvider(options: CreateSchedulerOptions = {}): SchedulerProvider {
  const provider =
    options.provider ?? (process.env.SCHEDULER_PROVIDER as CreateSchedulerOptions["provider"]) ?? "mock";

  if (provider === "buffer") {
    const accessToken = options.bufferAccessToken ?? process.env.BUFFER_ACCESS_TOKEN;
    if (accessToken) {
      return new BufferSchedulerProvider({ accessToken });
    }
    console.warn("[scheduler] SCHEDULER_PROVIDER=buffer but BUFFER_ACCESS_TOKEN is missing — falling back to MockSchedulerProvider.");
  }

  return new MockSchedulerProvider();
}
