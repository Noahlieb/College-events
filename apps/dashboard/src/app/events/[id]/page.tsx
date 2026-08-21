import { and, eq, ne } from "drizzle-orm";
import { db, eventSources, events, rawContent, sources } from "@college-events/db";
import { EVENT_CATEGORIES } from "@college-events/core";
import { mergeEventsAction, updateEventAction } from "@/lib/actions";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ postId?: string }>;
}) {
  const { id } = await params;
  const { postId } = await searchParams;
  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) notFound();

  const links = await db
    .select({ source: sources, raw: rawContent, link: eventSources })
    .from(eventSources)
    .innerJoin(sources, eq(eventSources.sourceId, sources.id))
    .innerJoin(rawContent, eq(eventSources.rawContentId, rawContent.id))
    .where(eq(eventSources.eventId, id));

  const nearbyCandidates = await db
    .select()
    .from(events)
    .where(and(eq(events.schoolId, event.schoolId), ne(events.id, id), ne(events.status, "rejected")))
    .limit(30);

  const bucketScores = event.bucketScores;
  const flags = event.flags;

  return (
    <>
      <p>
        {postId ? <a href={`/posts/${postId}`}>← back to post</a> : <a href="/events">← back to events</a>}
      </p>
      <h1>{event.name}</h1>
      <p className="subtitle">
        {event.category.replace("_", " ")} · {new Date(event.startAt).toLocaleString()} ·{" "}
        <span className={`badge badge-${event.verificationStatus === "conflict" ? "red" : "blue"}`}>
          {event.verificationStatus}
        </span>
      </p>

      {flags.length > 0 && (
        <div className="flags" style={{ marginBottom: 16 }}>
          {flags.map((f) => (
            <span className="flag-pill" key={f}>
              {f}
            </span>
          ))}
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Edit event</h2>
          </div>
          <p style={{ padding: "0 16px", margin: "12px 0 0", fontSize: 12, color: "var(--muted)" }}>
            Name, venue, price, and description are exactly what's printed on the rendered slide image. After saving,{" "}
            {postId ? (
              <>
                go <a href={`/posts/${postId}`}>back to the post</a> and click <strong>Re-render</strong> to regenerate
                the image with the updated text.
              </>
            ) : (
              <>re-render any post using this event to see the updated text on the image.</>
            )}
          </p>
          <form action={updateEventAction.bind(null, event.id)} style={{ padding: 16 }}>
            <label>Name</label>
            <input name="name" defaultValue={event.name} />
            <label>Venue</label>
            <input name="venue" defaultValue={event.venue ?? ""} />
            <label>Price</label>
            <input name="price" defaultValue={event.price ?? ""} />
            <label>Category</label>
            <select name="category" defaultValue={event.category}>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label>Description</label>
            <textarea name="description" rows={4} defaultValue={event.description ?? ""} />
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" type="submit">
                Save changes
              </button>
            </div>
          </form>
        </div>

        <div>
          <div className="panel">
            <div className="panel-header">
              <h2 style={{ margin: 0 }}>Scores & confidence</h2>
            </div>
            <table>
              <tbody>
                <tr>
                  <td>Overall relevance</td>
                  <td>{bucketScores.overall}</td>
                </tr>
                <tr>
                  <td>Monday campus</td>
                  <td>{bucketScores.mondayCampus}</td>
                </tr>
                <tr>
                  <td>Midweek activity</td>
                  <td>{bucketScores.midweekActivity}</td>
                </tr>
                <tr>
                  <td>Thursday nightlife</td>
                  <td>{bucketScores.thursdayNightlife}</td>
                </tr>
                <tr>
                  <td>Extraction confidence</td>
                  <td>{(event.confidenceScore * 100).toFixed(0)}%</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2 style={{ margin: 0 }}>Sources ({links.length})</h2>
            </div>
            <table>
              <tbody>
                {links.map((l) => (
                  <tr key={l.raw.id}>
                    <td>{l.source.name}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>
                      {l.link.sourceUrl ? (
                        <a href={l.link.sourceUrl} target="_blank" rel="noreferrer">
                          view source
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
                {links.length === 0 && (
                  <tr>
                    <td className="empty">No linked sources.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2 style={{ margin: 0 }}>Merge duplicate into this event</h2>
            </div>
            <form action={mergeEventsAction.bind(null, event.id)} style={{ padding: 16 }}>
              <label>Duplicate event to merge in (will be marked REJECTED, its sources re-linked here)</label>
              <select name="duplicateEventId" required>
                <option value="">Select an event…</option>
                {nearbyCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {new Date(c.startAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: 14 }}>
                <button className="btn" type="submit">
                  Merge
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
