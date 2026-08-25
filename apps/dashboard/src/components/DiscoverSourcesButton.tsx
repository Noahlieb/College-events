"use client";

import { useState, useTransition } from "react";

/**
 * A plain `<form action={serverAction}>` button gives zero visible
 * feedback while its action runs, and none at all if the action throws or
 * the request times out — the click just silently does nothing. That is
 * exactly what discovery's own request shape makes likely: it fires
 * dozens of sequential external HTTP calls, easily exceeding Vercel's
 * serverless function time limit even at its maximum setting.
 *
 * This wraps the same server action in a client component so a stuck or
 * failed run is visible instead of indistinguishable from "the button
 * didn't work."
 */
export function DiscoverSourcesButton({ action }: { action: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        // A timeout on Vercel surfaces here as a rejected fetch — this is
        // the "nothing happens" failure mode made visible.
        setError(
          err instanceof Error
            ? err.message
            : "Discovery didn't finish — it may have timed out. Try `pnpm worker discover <school>` from a terminal instead, which has no time limit.",
        );
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button className="btn btn-primary" type="button" onClick={run} disabled={pending}>
        {pending ? "Discovering… (can take a few minutes)" : "Discover sources"}
      </button>
      {error && (
        <div style={{ fontSize: 11, color: "var(--red, #e5484d)", maxWidth: 320, textAlign: "right" }}>
          {error}
        </div>
      )}
    </div>
  );
}
