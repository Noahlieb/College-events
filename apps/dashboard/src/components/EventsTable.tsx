"use client";

import { useMemo, useState } from "react";
import { approveEventAction, forceIncludeEventAction, rejectEventAction } from "@/lib/actions";

const LANE_LABEL: Record<string, string> = {
  monday_campus: "Mon · Campus",
  thursday_nightlife: "Thu · Nightlife",
};

const VERIFICATION_BADGE: Record<string, string> = {
  verified: "badge-green",
  high_confidence: "badge-blue",
  needs_review: "badge-amber",
  conflict: "badge-red",
  rejected: "badge-muted",
};

const STATUS_BADGE: Record<string, string> = {
  candidate: "badge-amber",
  active: "badge-green",
  selected: "badge-blue",
  published: "badge-purple",
  expired: "badge-muted",
  rejected: "badge-red",
};

export interface EventRow {
  id: string;
  name: string;
  startAt: string; // ISO
  venue: string | null;
  category: string;
  lane: string | null; // postType, or null when no lane accepts this category
  score: number;
  verificationStatus: string;
  status: string;
  sourceName: string | null;
  sourceImage: string | null;
  flags: string[];
}

type SortKey = "name" | "startAt" | "venue" | "category" | "score" | "verificationStatus" | "status" | "sourceName";

/**
 * All sorting/searching happens client-side over the rows the server
 * already filtered by status/category/verification (those stay query-param
 * driven — they scope which events are even in play). This table only
 * reorders and further narrows what's on screen, so there's no round trip
 * for either a header click or a keystroke.
 */
export function EventsTable({ rows }: { rows: EventRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("startAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.venue, r.category, r.sourceName]
        .filter((v): v is string => !!v)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last regardless of direction
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const sortHeader = (key: SortKey, label: string) => (
    <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort(key)}>
      {label}
      {sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search events by name, venue, category, or source…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: "100%", maxWidth: 420 }}
        />
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th></th>
              {sortHeader("name", "Event")}
              {sortHeader("startAt", "Date")}
              {sortHeader("venue", "Venue")}
              {sortHeader("category", "Category")}
              {/* Not sortable — derived from category + timing, not a stored
                  column, so there's no single scalar to compare rows on
                  beyond what category sorting already gives. */}
              <th>Goes to</th>
              {sortHeader("score", "Score")}
              {sortHeader("verificationStatus", "Verification")}
              {sortHeader("status", "Status")}
              {sortHeader("sourceName", "Source")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id}>
                <td>
                  {e.sourceImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="thumb" src={e.sourceImage} alt="" />
                  ) : (
                    <div className="thumb" />
                  )}
                </td>
                <td>
                  <a href={`/events/${e.id}`}>{e.name}</a>
                  {e.flags.length > 0 && (
                    <div className="flags">
                      {e.flags.map((f) => (
                        <span className="flag-pill" key={f}>
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {new Date(e.startAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </td>
                <td>{e.venue ?? "—"}</td>
                <td>{e.category.replace("_", " ")}</td>
                <td>
                  {e.lane ? (
                    <span className="badge badge-blue">{LANE_LABEL[e.lane] ?? e.lane}</span>
                  ) : (
                    <span className="badge badge-muted" title="No weekly post accepts this category — force-include it to use it">
                      no post
                    </span>
                  )}
                </td>
                <td>{e.score}</td>
                <td>
                  <span className={`badge ${VERIFICATION_BADGE[e.verificationStatus] ?? "badge-muted"}`}>
                    {e.verificationStatus.replace(/_/g, " ")}
                  </span>
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[e.status] ?? "badge-muted"}`}>{e.status}</span>
                </td>
                <td style={{ maxWidth: 140, fontSize: 12, color: "var(--muted)" }}>{e.sourceName ?? "—"}</td>
                <td>
                  <div className="btn-row">
                    <form action={approveEventAction.bind(null, e.id)} className="inline">
                      <button className="btn btn-sm" type="submit">
                        Approve
                      </button>
                    </form>
                    <form action={rejectEventAction.bind(null, e.id)} className="inline">
                      <button className="btn btn-sm btn-danger" type="submit">
                        Reject
                      </button>
                    </form>
                    <form action={forceIncludeEventAction.bind(null, e.id)} className="inline">
                      <button className="btn btn-sm" type="submit">
                        Force include
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="empty">
                  {query ? "No events match your search." : "No events match this filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
