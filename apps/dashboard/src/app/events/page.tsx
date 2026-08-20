import { and, desc, eq } from "drizzle-orm";
import { db, events } from "@college-events/db";
import { laneForEvent } from "@college-events/core";
import { getCurrentSchool } from "@/lib/current-school";
import { approveEventAction, forceIncludeEventAction, rejectEventAction } from "@/lib/actions";

/** Short label for the weekly post an event's category routes it to. */
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

export const dynamic = "force-dynamic";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; verification?: string }>;
}) {
  const params = await searchParams;
  const school = await getCurrentSchool();

  const filters = [eq(events.schoolId, school.id)];
  if (params.status) filters.push(eq(events.status, params.status as (typeof events.status.enumValues)[number]));
  if (params.category) filters.push(eq(events.category, params.category as (typeof events.category.enumValues)[number]));
  if (params.verification)
    filters.push(eq(events.verificationStatus, params.verification as (typeof events.verificationStatus.enumValues)[number]));

  const rows = await db
    .select()
    .from(events)
    .where(and(...filters))
    .orderBy(desc(events.startAt));

  return (
    <>
      <h1>Event inventory</h1>
      <p className="subtitle">{rows.length} events {params.status || params.category || params.verification ? "(filtered)" : ""}</p>

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <a className="btn" href="/events">All</a>
        <a className="btn" href="/events?status=candidate">Needs review</a>
        <a className="btn" href="/events?verification=conflict">Conflicts</a>
        <a className="btn" href="/events?status=active">Active</a>
        <a className="btn" href="/events?status=expired">Expired</a>
        <a className="btn" href="/events?status=rejected">Rejected</a>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Event</th>
              <th>Date</th>
              <th>Venue</th>
              <th>Category</th>
              <th>Goes to</th>
              <th>Score</th>
              <th>Verification</th>
              <th>Status</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const bucket = e.bucketScores;
              const flags = e.flags;
              return (
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
                    {flags.length > 0 && (
                      <div className="flags">
                        {flags.map((f) => (
                          <span className="flag-pill" key={f}>
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{new Date(e.startAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td>{e.venue ?? "—"}</td>
                  <td>{e.category.replace("_", " ")}</td>
                  <td>
                    {(() => {
                      const lane = laneForEvent({
                        category: e.category,
                        startAt: e.startAt.toISOString(),
                        timezone: school.timezone,
                      });
                      return lane ? (
                        <span className="badge badge-blue">{LANE_LABEL[lane.postType] ?? lane.postType}</span>
                      ) : (
                        // Not an error — these categories are deliberately not
                        // auto-posted. Shown so they're visibly parked rather
                        // than appearing to vanish from the schedule.
                        <span className="badge badge-muted" title="No weekly post accepts this category — force-include it to use it">
                          no post
                        </span>
                      );
                    })()}
                  </td>
                  <td>{bucket.overall}</td>
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
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="empty">
                  No events match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
