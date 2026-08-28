import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db, events } from "@college-events/db";
import { laneForEvent, localDateRangeToUtc } from "@college-events/core";
import { getCurrentSchool } from "@/lib/current-school";
import { EventsTable, type EventRow } from "@/components/EventsTable";
import { ShortenDescriptionsButton } from "@/components/ShortenDescriptionsButton";

export const dynamic = "force-dynamic";
// shortenDescriptionsAction below runs one AI call per long-description
// event for the school — comfortably past the platform's default timeout
// on a school with a lot of backfilled history.
export const maxDuration = 300;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; verification?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const school = await getCurrentSchool();

  const filters = [eq(events.schoolId, school.id)];
  if (params.status) filters.push(eq(events.status, params.status as (typeof events.status.enumValues)[number]));
  if (params.category) filters.push(eq(events.category, params.category as (typeof events.category.enumValues)[number]));
  if (params.verification)
    filters.push(eq(events.verificationStatus, params.verification as (typeof events.verificationStatus.enumValues)[number]));

  // Dates are picked against the school's local calendar (see the date
  // inputs below), so the day boundaries have to be converted through its
  // timezone rather than compared as UTC midnight — otherwise a school
  // west of UTC would see events from the evening before creep into "today".
  const { start: fromDate, end: toDate } = localDateRangeToUtc(params.from ?? null, params.to ?? null, school.timezone);
  if (fromDate) filters.push(gte(events.startAt, fromDate));
  if (toDate) filters.push(lt(events.startAt, toDate));

  const rows = await db
    .select()
    .from(events)
    .where(and(...filters))
    .orderBy(desc(events.startAt));

  const tableRows: EventRow[] = rows.map((e) => {
    const lane = laneForEvent({
      category: e.category,
      startAt: e.startAt.toISOString(),
      timezone: school.timezone,
      manualLane: e.manualLane,
    });
    return {
      id: e.id,
      name: e.name,
      startAt: e.startAt.toISOString(),
      venue: e.venue,
      category: e.category,
      lane: lane?.postType ?? null,
      manualLane: e.manualLane,
      score: e.bucketScores.overall,
      verificationStatus: e.verificationStatus,
      status: e.status,
      sourceName: e.sourceName,
      sourceImage: e.sourceImage,
      flags: e.flags,
    };
  });

  const isFiltered = Boolean(params.status || params.category || params.verification || params.from || params.to);

  // Preserves whichever quick filter is active when the date range is
  // applied, and drops only from/to when cleared, so the two filter rows
  // combine instead of one silently resetting the other.
  const clearDatesParams = new URLSearchParams();
  if (params.status) clearDatesParams.set("status", params.status);
  if (params.category) clearDatesParams.set("category", params.category);
  if (params.verification) clearDatesParams.set("verification", params.verification);
  const clearDatesHref = `/events${clearDatesParams.toString() ? `?${clearDatesParams}` : ""}`;

  return (
    <>
      <h1>Event inventory</h1>
      <p className="subtitle">{rows.length} events {isFiltered ? "(filtered)" : ""}</p>

      <div className="btn-row" style={{ marginBottom: 12, justifyContent: "space-between" }}>
        <div className="btn-row">
          <a className="btn" href="/events">All</a>
          <a className="btn" href="/events?status=candidate">Needs review</a>
          <a className="btn" href="/events?verification=conflict">Conflicts</a>
          <a className="btn" href="/events?status=active">Active</a>
          <a className="btn" href="/events?status=expired">Expired</a>
          <a className="btn" href="/events?status=rejected">Rejected</a>
        </div>
        <ShortenDescriptionsButton />
      </div>

      <form method="GET" action="/events" className="btn-row" style={{ marginBottom: 16, alignItems: "center" }}>
        {params.status && <input type="hidden" name="status" value={params.status} />}
        {params.category && <input type="hidden" name="category" value={params.category} />}
        {params.verification && <input type="hidden" name="verification" value={params.verification} />}
        <label style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>From</label>
        <input type="date" name="from" defaultValue={params.from ?? ""} style={{ width: 160 }} />
        <label style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>To</label>
        <input type="date" name="to" defaultValue={params.to ?? ""} style={{ width: 160 }} />
        <button className="btn btn-sm" type="submit">Apply</button>
        {(params.from || params.to) && (
          <a className="btn btn-sm" href={clearDatesHref}>Clear dates</a>
        )}
      </form>

      <EventsTable rows={tableRows} />
    </>
  );
}
