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
        <div style={{ overflowX: "auto" }}>
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
                <td>
                  <CategorySelect eventId={e.id} category={e.category} />
                </td>
                <td>
                  <LaneSelect eventId={e.id} lane={e.lane} manualLane={e.manualLane} />
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
    <select value={category} onChange={onChange} disabled={pending} style={{ fontSize: 12, width: 140 }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <select value={manualLane ?? AUTO_VALUE} onChange={onChange} disabled={pending} style={{ fontSize: 12, width: 150 }}>
        <option value={AUTO_VALUE}>Auto{lane ? ` (${LANE_LABEL[lane] ?? lane})` : " (no post)"}</option>
        {LANE_OVERRIDE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {!manualLane && !lane && (
        <span className="badge badge-muted" style={{ fontSize: 10 }} title="No weekly post accepts this category — force-include it, or pin a lane above">
          no post
        </span>
      )}
    </div>
  );
}
