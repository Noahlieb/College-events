"use client";

import { useState, useTransition } from "react";
import { buildWeeklyPostsAction, type BuildWeeklyPostsResult } from "@/lib/render-action";

const POST_TYPE_LABEL: Record<string, string> = {
  monday_campus: "Monday — Campus",
  midweek_activities: "Midweek — Things To Do",
  thursday_nightlife: "Thursday — Weekend Guide",
  custom: "Custom",
};

/**
 * One click: assemble which active events go in each lane's post, then
 * render every resulting post's carousel image. Same silent-failure risk
 * as every other bulk action in this app — assembling several weeks of
 * posts across every lane, then rendering each one over HTTP to the
 * render-service, is real work that a plain `<form action>` gives no
 * feedback on while it runs.
 */
export function BuildWeeklyPostsButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildWeeklyPostsResult | null>(null);

  const run = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await buildWeeklyPostsAction());
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Didn't finish — it may have timed out. Try `pnpm worker select-posts <school>` and `pnpm worker render-all <school>` from a terminal instead, which have no time limit.",
        );
      }
    });
  };

  const failedRenders = result?.rendered.filter((r) => !r.ok) ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
      <button className="btn btn-primary" type="button" onClick={run} disabled={pending}>
        {pending ? "Building… (can take a minute or two)" : "Build this week's posts"}
      </button>
      {error && <div style={{ fontSize: 12, color: "var(--red, #e5484d)", maxWidth: 480 }}>{error}</div>}
      {result && (
        <div style={{ fontSize: 12, color: "var(--muted)", maxWidth: 480 }}>
          <div>
            Selected {result.selected.length} post{result.selected.length === 1 ? "" : "s"} (
            {result.selected.reduce((sum, s) => sum + s.eventCount, 0)} events total) — rendered{" "}
            {result.rendered.length - failedRenders.length} of {result.rendered.length}.
          </div>
          {failedRenders.length > 0 && (
            <div style={{ marginTop: 6, color: "var(--red, #e5484d)" }}>
              {failedRenders.map((f) => {
                const s = result.selected.find((sel) => sel.postId === f.postId);
                return (
                  <div key={f.postId}>
                    {s ? `${POST_TYPE_LABEL[s.postType] ?? s.postType} (${s.scheduledDate})` : f.postId}: {f.error}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
