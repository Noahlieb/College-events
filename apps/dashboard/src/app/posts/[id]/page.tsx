import { asc, eq } from "drizzle-orm";
import { db, events, postEvents, posts, renderedAssets, schools } from "@college-events/db";
import { notFound } from "next/navigation";
import { toDisplayUrl } from "@/lib/media";
import { approvePostAction, rejectPostAction, schedulePostAction } from "@/lib/actions";
import { renderPostAction } from "@/lib/render-action";
import { DownloadAllSlidesButton } from "@/components/DownloadSlidesButton";

export const dynamic = "force-dynamic";

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) notFound();

  const [school] = await db.select().from(schools).where(eq(schools.id, post.schoolId)).limit(1);
  const handle = school?.instagramAccount ?? (school ? `@${school.shortName.toLowerCase()}` : "@preview");

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
          <div className="btn-row" style={{ gap: 8 }}>
            {assets.length > 0 && <DownloadAllSlidesButton assetIds={assets.map((a) => a.id)} />}
            <form action={renderPostAction.bind(null, post.id)}>
              <button className="btn btn-sm" type="submit" disabled={!canRender}>
                {assets.length > 0 ? "Re-render" : "Render"}
              </button>
            </form>
          </div>
        </div>
        {assets.length > 0 ? (
          <div className="ig-card">
            <div className="ig-card-header">
              <span className="ig-avatar" />
              <span className="ig-handle">{handle}</span>
            </div>

            {assets.map((a, i) => (
              <input
                key={`r-${a.id}`}
                type="radio"
                name="slide"
                id={`slide-${i}`}
                className="slide-radio-hidden"
                defaultChecked={i === 0}
              />
            ))}
            <div className="ig-image-frame">
              {assets.map((a) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a.id} src={toDisplayUrl(a.storageUrl, a.id)} alt={a.template} className="slide-image" />
              ))}
            </div>
            <div className="ig-thumbs">
              {assets.map((a, i) => (
                <label key={a.id} htmlFor={`slide-${i}`} className="thumb-label">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={toDisplayUrl(a.storageUrl, a.id)} alt={a.template} />
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, padding: "8px 0 0", flexWrap: "wrap" }}>
              {assets.map((a, i) => (
                <a key={a.id} href={`/api/assets/${a.id}/download`} className="btn btn-sm" style={{ fontSize: 11 }}>
                  ↓ Slide {i + 1}
                </a>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty">Not rendered yet. Click "Render" to generate the carousel images.</div>
        )}
      </div>

      <div className="grid-2">
        <div className="panel">
          <details className="caption-box">
            <summary>Caption{post.caption ? ` — ${post.caption.length} characters, click to expand` : ""}</summary>
            <pre>{post.caption ?? "(no caption generated yet)"}</pre>
          </details>
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
                  <td>{event.name}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(event.startAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <a href={`/events/${event.id}?postId=${post.id}`} className="btn btn-sm">
                      Edit text
                    </a>
                  </td>
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
