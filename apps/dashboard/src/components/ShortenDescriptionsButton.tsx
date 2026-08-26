"use client";

import { useState, useTransition } from "react";
import { shortenDescriptionsAction, type ShortenDescriptionsSummary } from "@/lib/actions";

/**
 * One-time backfill trigger for events that predate description
 * auto-shortening — see shortenDescriptionsAction. Same pending/error
 * pattern as every other longer-running action button in this app.
 */
export function ShortenDescriptionsButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ShortenDescriptionsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await shortenDescriptionsAction());
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Didn't finish — it may have timed out. Try `pnpm worker shorten-descriptions <school>` from a terminal instead, which has no time limit.",
        );
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <button className="btn btn-sm" type="button" onClick={run} disabled={pending}>
        {pending ? "Shortening…" : "Shorten long descriptions"}
      </button>
      {error && <div style={{ fontSize: 12, color: "var(--red, #e5484d)", maxWidth: 420 }}>{error}</div>}
      {result && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Checked {result.inspected}, shortened {result.shortened}, {result.unchanged} already fine
          {result.failed > 0 ? `, ${result.failed} failed` : ""}.
        </div>
      )}
    </div>
  );
}
