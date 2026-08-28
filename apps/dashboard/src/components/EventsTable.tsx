"use client";

import { useMemo, useState, useTransition } from "react";
import { EVENT_CATEGORIES, type EventCategory, type PostType } from "@college-events/core";
import {
  approveEventAction,
  forceIncludeEventAction,
  rejectEventAction,
  updateEventCategoryAction,
  updateEventLaneOverrideAction,
} from "@/lib/actions";

const LANE_LABEL: Record<string, string> = {
  monday_campus: "Mon · Campus",
  thursday_nightlife: "Thu · Nightlife",
};

/** Every lane an event can be manually pinned to — kept separate from
 * LANE_LABEL's keys since that map is also indexed by lane values that
 * come from the DB and shouldn't silently gain a new option just because
 * a schedule slot uses a new postType string. */
const LANE_OVERRIDE_OPTIONS: { value: PostType; label: string }[] = [
  { value: "monday_campus", label: "Mon · Campus" },
  { value: "thursday_nightlife", label: "Thu · Nightlife" },
];

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
  category: EventCategory;
  lane: string | null; // postType, or null when no lane accepts this category
  manualLane: PostType | null; // operator's explicit "goes to" override, if any
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
 *
 * Columns are deliberately compact — thumbnail folded into the event cell,
 * category/lane stacked into one "Routing" cell, verification/status
 * stacked into one "Status" cell — so a full row of controls fits inside
 * the page width instead of needing a horizontal scrollbar to reach the
 * action buttons.
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

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const sortHeader = (key: SortKey, label: string) => (
    <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort(key)}>
      {label}
      {sortArrow(key)}
    </th>
  );

  /** A sortable sub-label used inside a header cell that's shared by two
   * stacked columns (Routing, Status) — same click behavior as sortHeader,
   * just not its own <th>. */
  const sortSubLabel = (key: SortKey, label: string) => (
    <div style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort(key)}>
      {label}
      {sortArrow(key)}
    </div>
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
        <div style={{ overflowX: "auto" }}>
          <table className="events-table">
            <thead>
              <tr>
                {sortHeader("name", "Event")}
                {sortHeader("startAt", "Date")}
                {sortHeader("venue", "Venue")}
                <th>
                  {sortSubLabel("category", "Category")}
                  <div className="th-sublabel">Goes to</div>
                </th>
                {sortHeader("score", "Score")}
                <th>
                  {sortSubLabel("verificationStatus", "Verify")}
                  {sortSubLabel("status", "Status")}
                </th>
                {sortHeader("sourceName", "Source")}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      {e.sourceImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="thumb-sm" src={e.sourceImage} alt="" />
                      ) : (
                        <div className="thumb-sm" />
                      )}
                      <div style={{ minWidth: 0 }}>
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
                      </div>
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(e.startAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td className="truncate-cell" style={{ maxWidth: 130 }} title={e.venue ?? undefined}>
                    {e.venue ?? "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <CategorySelect eventId={e.id} category={e.category} />
                      <LaneSelect eventId={e.id} lane={e.lane} manualLane={e.manualLane} />
                    </div>
                  </td>
                  <td style={{ textAlign: "center" }}>{e.score}</td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                      <span className={`badge ${VERIFICATION_BADGE[e.verificationStatus] ?? "badge-muted"}`}>
                        {e.verificationStatus.replace(/_/g, " ")}
                      </span>
                      <span className={`badge ${STATUS_BADGE[e.status] ?? "badge-muted"}`}>{e.status}</span>
                    </div>
                  </td>
                  <td className="truncate-cell" style={{ maxWidth: 100, color: "var(--muted)" }} title={e.sourceName ?? undefined}>
                    {e.sourceName ?? "—"}
                  </td>
                  <td>
                    <div className="btn-row" style={{ flexWrap: "nowrap", gap: 4 }}>
                      <form action={approveEventAction.bind(null, e.id)} className="inline">
                        <button className="btn btn-sm btn-icon" type="submit" title="Approve">
                          ✓
                        </button>
                      </form>
                      <form action={rejectEventAction.bind(null, e.id)} className="inline">
                        <button className="btn btn-sm btn-danger btn-icon" type="submit" title="Reject">
                          ✕
                        </button>
                      </form>
                      <form action={forceIncludeEventAction.bind(null, e.id)} className="inline">
                        <button className="btn btn-sm btn-icon" type="submit" title="Force include (bypass score/slot caps)">
                          Force
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    {query ? "No events match your search." : "No events match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/**
 * Inline category fix, right on the events list — miscategorized "other"
 * rows were common enough (see the CSV importer's categorizeEvent
 * fallback) that opening each one just to change this one field was
 * real friction. "Goes to" is derived from category, not stored
 * separately, so fixing it here is what fixes that column too — the
 * server action's revalidatePath brings fresh lane data back down
 * automatically, no separate handling needed.
 */
function CategorySelect({ eventId, category }: { eventId: string; category: EventCategory }) {
  const [pending, startTransition] = useTransition();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as EventCategory;
    startTransition(async () => {
      await updateEventCategoryAction(eventId, next);
    });
  };

  return (
    <select value={category} onChange={onChange} disabled={pending} className="select-compact">
      {EVENT_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {c.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

const AUTO_VALUE = "__auto__";

/**
 * "Goes to" edit control. `lane` is always the system's current answer
 * (auto-routing already folds in the manual pick and the after-9pm rule —
 * see laneForEvent), while `manualLane` is only non-null when an operator
 * has pinned it. Selecting "Auto" clears the pin and returns the event to
 * normal routing; picking a lane explicitly pins it there even past what
 * category/timing would otherwise decide.
 */
function LaneSelect({ eventId, lane, manualLane }: { eventId: string; lane: string | null; manualLane: PostType | null }) {
  const [pending, startTransition] = useTransition();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    startTransition(async () => {
      await updateEventLaneOverrideAction(eventId, next === AUTO_VALUE ? null : (next as PostType));
    });
  };

  return (
    <select value={manualLane ?? AUTO_VALUE} onChange={onChange} disabled={pending} className="select-compact">
      <option value={AUTO_VALUE}>Auto{lane ? ` (${LANE_LABEL[lane] ?? lane})` : " (no post)"}</option>
      {LANE_OVERRIDE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
