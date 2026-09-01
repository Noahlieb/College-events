"use client";

import { useMemo, useState, useTransition } from "react";
import { buildSelectedPostsAction, type BuildWeeklyPostsResult } from "@/lib/render-action";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-muted",
  needs_review: "badge-amber",
  ready_for_approval: "badge-blue",
  approved: "badge-green",
  scheduled: "badge-purple",
  published: "badge-green",
  rejected: "badge-red",
  error: "badge-red",
};

const POST_TYPE_LABEL: Record<string, string> = {
  monday_campus: "Monday — Campus",
  midweek_activities: "Midweek — Things To Do",
  thursday_nightlife: "Thursday — Weekend Guide",
  custom: "Custom",
};

export interface PostRow {
  id: string;
  postType: string;
  scheduledDate: string;
  title: string;
  eventCount: number;
  caption: string | null;
  status: string;
}

/**
 * Weekly posts table with per-row checkboxes so a build can target just
 * the posts that actually need re-rendering (an edited event, a fixed
 * image) instead of every post the school has every time — the render
 * step is the slow, external, failure-prone part of a build (one HTTP
 * call per post to render-service), so that's specifically what selection
 * scopes; the underlying event-assignment refresh still runs for
 * everything either way, since it's a cheap, idempotent DB-only pass. See
 * buildSelectedPostsAction's doc comment for the full reasoning.
 */
export function PostsTable({ rows }: { rows: PostRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildWeeklyPostsResult | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildSelected = () => {
    setError(null);
    setResult(null);
    const ids = [...selected];
    startTransition(async () => {
      try {
        setResult(await buildSelectedPostsAction(ids));
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Didn't finish — it may have timed out. Try again, or render individual posts from their own page.",
        );
      }
    });
  };

  const failedRenders = useMemo(() => result?.rendered.filter((r) => !r.ok) ?? [], [result]);

  return (
    <>
      <div className="btn-row" style={{ marginBottom: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div className="btn-row" style={{ alignItems: "center" }}>
          <button className="btn btn-sm" type="button" onClick={toggleAll} disabled={rows.length === 0}>
            {allSelected ? "Select none" : "Select all"}
          </button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {selected.size} of {rows.length} selected
          </span>
        </div>
        <button className="btn btn-primary btn-sm" type="button" onClick={buildSelected} disabled={pending || selected.size === 0}>
          {pending ? "Building…" : `Build selected (${selected.size})`}
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: "var(--red, #e5484d)", marginBottom: 12 }}>{error}</div>}
      {result && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          <div>
            Rendered {result.rendered.length - failedRenders.length} of {result.rendered.length} selected post
            {result.rendered.length === 1 ? "" : "s"}.
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

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label="Select all posts"
                  style={{ width: "auto" }}
                />
              </th>
              <th>Post</th>
              <th>Date</th>
              <th>Slides</th>
              <th>Caption</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((post) => (
              <tr key={post.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(post.id)}
                    onChange={() => toggleOne(post.id)}
                    aria-label={`Select ${post.title}`}
                    style={{ width: "auto" }}
                  />
                </td>
                <td>
                  <strong>{POST_TYPE_LABEL[post.postType] ?? post.postType}</strong>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{post.title}</div>
                </td>
                <td>{post.scheduledDate}</td>
                <td>{post.eventCount}</td>
                <td style={{ maxWidth: 260, fontSize: 12, color: "var(--muted)" }}>
                  {post.caption ? post.caption.split("\n")[0]!.slice(0, 90) : "—"}
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[post.status] ?? "badge-muted"}`}>{post.status.replace(/_/g, " ")}</span>
                </td>
                <td>
                  <a className="btn btn-sm" href={`/posts/${post.id}`}>
                    Open
                  </a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No posts yet. Click &quot;Build this week&apos;s posts&quot; above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
