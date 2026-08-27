import { and, desc, eq } from "drizzle-orm";
import { db, events } from "@college-events/db";
import { laneForEvent } from "@college-events/core";
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

  return (
    <>
      <h1>Event inventory</h1>
      <p className="subtitle">{rows.length} events {params.status || params.category || params.verification ? "(filtered)" : ""}</p>

      <div className="btn-row" style={{ marginBottom: 16, justifyContent: "space-between" }}>
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

      <EventsTable rows={tableRows} />
    </>
  );
}
