import { asc, eq } from "drizzle-orm";
import { db, events, postEvents, posts, renderedAssets } from "@college-events/db";
import { notFound } from "next/navigation";
import { toDisplayUrl } from "@/lib/media";
import { approvePostAction, rejectPostAction, renderPostAction, schedulePostAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) notFound();

  const linkedEvents = await db
    .select({ event: events, position: postEvents.position })
    .from(postEvents)
    .innerJoin(events, eq(postEvents.eventId, events.id))
    .where(eq(postEvents.postId, id))
    .orderBy(asc(postEvents.position));

  const assets = await db
    .select()
    .from(renderedAssets)
    .where(eq(renderedAssets.postId, id))
    .orderBy(asc(renderedAssets.createdAt));

  const canApprove = post.status === "ready_for_approval" || post.status === "needs_review";
  const canRender = !["published"].includes(post.status);
  const canSchedule = post.status === "approved";

  return (
    <>
      <p>
        <a href="/posts">← back to posts</a>
      </p>
      <h1>{post.title}</h1>
      <p className="subtitle">
        {post.scheduledDate} · <span className="badge badge-blue">{post.status.replace(/_/g, " ")}</span>
        {post.schedulerId && <> · scheduler id: {post.schedulerId}</>}
      </p>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Carousel preview</h2>
          <form action={renderPostAction.bind(null, post.id)}>
            <button className="btn btn-sm" type="submit" disabled={!canRender}>
              {assets.length > 0 ? "Re-render" : "Render"}
            </button>
          </form>
        </div>
        {assets.length > 0 ? (
          <div className="carousel">
            {assets.map((a) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={a.id} src={toDisplayUrl(a.storageUrl)} alt={a.template} />
            ))}
          </div>
        ) : (
          <div className="empty">Not rendered yet. Click "Render" to generate the carousel images.</div>
        )}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Caption</h2>
          </div>
          <pre style={{ padding: 16, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13 }}>
            {post.caption ?? "(no caption generated yet)"}
          </pre>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Events in this post ({linkedEvents.length})</h2>
          </div>
          <table>
            <tbody>
              {linkedEvents.map(({ event }, i) => (
                <tr key={event.id}>
                  <td>{i + 1}</td>
                  <td>
                    <a href={`/events/${event.id}`}>{event.name}</a>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(event.startAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {linkedEvents.length === 0 && (
                <tr>
                  <td className="empty">No events selected for this post.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Human approval</h2>
        </div>
        <div style={{ padding: 16 }} className="btn-row">
          <form action={approvePostAction.bind(null, post.id)}>
            <button className="btn btn-primary" type="submit" disabled={!canApprove}>
              Approve
            </button>
          </form>
          <form action={rejectPostAction.bind(null, post.id)} className="btn-row" style={{ alignItems: "center" }}>
            <input name="reason" placeholder="Reason (optional)" style={{ width: 220 }} />
            <button className="btn btn-danger" type="submit" disabled={!canApprove}>
              Reject
            </button>
          </form>
          <form action={schedulePostAction.bind(null, post.id)}>
            <button className="btn" type="submit" disabled={!canSchedule}>
              Send to scheduler (Buffer)
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
