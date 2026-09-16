"use client";

import { useMemo, useState, useTransition } from "react";
import { EVENT_CATEGORIES, type EventCategory, type PostType } from "@college-events/core";
import {
  approveEventAction,
  bulkUpdateEventLaneAction,
  forceIncludeEventAction,
  rejectEventAction,
  updateEventCategoryAction,
  updateEventLaneOverrideAction,
} from "@/lib/actions";

/** Every lane an event can be manually pinned to — also doubles as the
 * lane→label lookup for LaneButtons, since both real postType values are
 * covered here and there's no separate "goes to no post" value to render
 * a label for (LaneButtons handles that case itself). */
const LANE_OVERRIDE_OPTIONS: { value: PostType; label: string }[] = [
  { value: "monday_campus", label: "Campus" },
  { value: "thursday_nightlife", label: "Nightlife" },
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

type SortKey = "name" | "startAt" | "venue" | "category" | "lane" | "score" | "verificationStatus" | "status" | "sourceName";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, startBulkTransition] = useTransition();

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

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleIds = sorted.map((e) => e.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAllVisible = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  };

  /** Bulk-pin (or bulk-clear) every selected row to one lane in a single
   * round trip (recommendation §5) — the alternative, clicking each row's
   * lane buttons one at a time, is exactly the friction a multi-select was
   * meant to remove. Selection is cleared right after firing: the rows
   * refresh via the action's own revalidatePath, and holding onto stale
   * ids across that refresh risks re-applying a bulk action to whatever
   * unrelated events later sort into the same positions. */
  const bulkSetLane = (lane: PostType | null) => {
    const ids = Array.from(selected);
    startBulkTransition(async () => {
      await bulkUpdateEventLaneAction(ids, lane);
    });
    setSelected(new Set());
  };

  return (
    <>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Search events by name, venue, category, or source…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: "100%", maxWidth: 420 }}
        />
        {selected.size > 0 && (
          <div className="btn-row" style={{ alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{selected.size} selected</span>
            {LANE_OVERRIDE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className="btn btn-sm"
                disabled={bulkPending}
                onClick={() => bulkSetLane(o.value)}
              >
                Set to {o.label}
              </button>
            ))}
            <button type="button" className="btn btn-sm" disabled={bulkPending} onClick={() => bulkSetLane(null)}>
              Clear pin
            </button>
            <button type="button" className="btn btn-sm btn-icon" disabled={bulkPending} onClick={() => setSelected(new Set())} title="Cancel selection">
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <div style={{ overflowX: "auto" }}>
          <table className="events-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all visible events" />
                </th>
                {sortHeader("name", "Event")}
                {sortHeader("startAt", "Date")}
                {sortHeader("venue", "Venue")}
                <th>
                  {sortSubLabel("category", "Category")}
                  {sortSubLabel("lane", "Goes to")}
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
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleRow(e.id)} aria-label={`Select ${e.name}`} />
                  </td>
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
                      <LaneButtons eventId={e.id} lane={e.lane} manualLane={e.manualLane} />
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
                  <td colSpan={9} className="empty">
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

/**
 * "Goes to" edit control. `lane` is always the system's current answer
 * (auto-routing already folds in the manual pick and the after-9pm rule —
 * see laneForEvent), while `manualLane` is only non-null when an operator
 * has pinned it.
 *
 * A dropdown here meant two clicks and a scan of a list to change one
 * value between exactly two real options — recommendation §2 asked for
 * single-click, glanceable assignment instead, so this is a pair of
 * always-visible pill buttons: clicking one pins the event there
 * immediately, no menu to open first. The currently-resolved lane is
 * always highlighted so the state reads at a glance without clicking
 * anything.
 *
 * Labels never say "Auto" or "Manual" — both states just show the lane
 * name, per recommendation §1. The distinction still needs to be visible
 * (an operator scanning for what's pinned vs. what's following the
 * rules), so it's carried by fill instead of text: solid when pinned,
 * outlined when the system chose it. A pinned event also gets a small ×
 * to clear the pin and return to auto-routing — the only control that
 * isn't a direct one-click lane pick, because "go back to letting the
 * rules decide" has no lane of its own to be a button for.
 */
function LaneButtons({ eventId, lane, manualLane }: { eventId: string; lane: string | null; manualLane: PostType | null }) {
  const [pending, startTransition] = useTransition();
  const isManual = manualLane != null;
  const resolved = manualLane ?? lane;

  const setLane = (next: PostType | null) => {
    startTransition(async () => {
      await updateEventLaneOverrideAction(eventId, next);
    });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {LANE_OVERRIDE_OPTIONS.map((o) => {
        const active = resolved === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={pending}
            onClick={() => setLane(o.value)}
            title={active ? (isManual ? "Manually pinned — click another lane to repin" : "Auto-assigned") : `Pin to ${o.label}`}
            style={{
              fontSize: 11,
              lineHeight: 1,
              padding: "3px 8px",
              borderRadius: 999,
              cursor: "pointer",
              border: `1px solid ${active ? "var(--accent, #5b8def)" : "var(--border, #444)"}`,
              background: active && isManual ? "var(--accent, #5b8def)" : "transparent",
              color: active ? (isManual ? "#fff" : "var(--accent, #5b8def)") : "var(--muted, #999)",
            }}
          >
            {o.label}
          </button>
        );
      })}
      {isManual && (
        <button
          type="button"
          disabled={pending}
          onClick={() => setLane(null)}
          title="Clear manual pin — return to auto-routing"
          style={{ fontSize: 12, padding: "0 3px", border: "none", background: "transparent", color: "var(--muted, #999)", cursor: "pointer" }}
        >
          ×
        </button>
      )}
      {!resolved && <span style={{ fontSize: 11, color: "var(--muted, #999)" }}>No post</span>}
    </div>
  );
}
