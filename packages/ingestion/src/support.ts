import type { AdapterSupportStatus, AdapterType, SourceHealthStatus } from "@college-events/core";
import { adapterFor } from "./registry.js";

/**
 * What a source's crawlability actually is, combining three things that
 * are easy to conflate: whether we have an adapter, whether that adapter
 * has what it needs to run, and how the last run went.
 */

/** Adapters that cannot work without a credential this deployment supplies. */
const CREDENTIAL_ENV: Partial<Record<AdapterType, string[]>> = {
  eventbrite: ["EVENTBRITE_API_TOKEN"],
  ticketmaster: ["TICKETMASTER_API_KEY"],
};

export interface AdapterSupport {
  status: AdapterSupportStatus;
  /** Shown to an operator. Says whose problem it is. */
  detail: string;
  /** Env vars that would unblock an `auth_required` source. */
  missingCredentials?: string[];
}

/**
 * Resolves a source's support status.
 *
 * The ordering matters: an operator's explicit "off" beats everything, a
 * missing adapter is reported before health because health is meaningless
 * for a source that was never crawlable, and only then does the last run's
 * outcome get a say.
 */
export function adapterSupport(args: {
  adapterType: AdapterType | null;
  active: boolean;
  healthStatus: SourceHealthStatus;
  consecutiveFailures?: number;
  env?: Record<string, string | undefined>;
}): AdapterSupport {
  const env = args.env ?? process.env;

  if (!args.active) {
    return { status: "disabled", detail: "Switched off by an operator." };
  }

  if (!args.adapterType) {
    return { status: "no_adapter", detail: "No platform detected for this source yet." };
  }

  const adapter = adapterFor(args.adapterType);
  if (!adapter) {
    return {
      status: "no_adapter",
      detail: `${args.adapterType} is detected but not yet supported — this is a gap on our side, not a problem with the source.`,
    };
  }

  const required = CREDENTIAL_ENV[args.adapterType] ?? [];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    return {
      status: "auth_required",
      detail: `${args.adapterType} needs ${missing.join(", ")} configured before it can be crawled.`,
      missingCredentials: missing,
    };
  }

  if (args.healthStatus === "degraded") {
    // Persistent refusal is worth its own word: it tells an operator to
    // stop expecting this source to recover on its own and find another
    // way to cover those events.
    const persistent = (args.consecutiveFailures ?? 0) >= 5;
    return persistent
      ? {
          status: "blocked",
          detail: "The platform has declined automated access repeatedly. We do not attempt to bypass it — cover these events from another source.",
        }
      : {
          status: "degraded",
          detail: "The platform declined automated access on the last run. Backing off; other sources should cover these events.",
        };
  }

  if (args.healthStatus === "disabled") {
    return { status: "disabled", detail: "Switched off." };
  }

  return { status: "supported", detail: `Crawled by the ${args.adapterType} adapter.` };
}

/** Whether a *platform* is crawlable at all, ignoring any one source. */
export function platformSupported(adapterType: AdapterType | null): boolean {
  return adapterType !== null && adapterFor(adapterType) !== null;
}
