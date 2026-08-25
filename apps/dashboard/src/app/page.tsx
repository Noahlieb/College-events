import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, events, posts, sources } from "@college-events/db";
import { getCurrentSchool } from "@/lib/current-school";
import { runProcessAction } from "@/lib/actions";
import { BuildWeeklyPostsButton } from "@/components/BuildWeeklyPostsButton";

// BuildWeeklyPostsButton's action crosses multiple weeks of selection plus
// a render-service HTTP call per resulting post.
export const maxDuration = 300;

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-muted",
  needs_review: "badge-amber",
  ready_for_approval: "badge-blue",
  approved: "badge-green",
  scheduled: "badge-purple",
  published: "badge-green",
  rejected: "badge-red",
  error: "badge-red",
};

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const school = await getCurrentSchool();

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.schoolId, school.id));

  const byCategory = await db
    .select({ category: events.category, count: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.schoolId, school.id))
    .groupBy(events.category)
    .orderBy(desc(sql`count(*)`));

  const byStatus = await db
    .select({ status: events.status, count: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.schoolId, school.id))
    .groupBy(events.status);

  const needsReviewCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.schoolId, school.id), eq(events.verificationStatus, "needs_review")));

  const conflictCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.schoolId, school.id), eq(events.verificationStatus, "conflict")));

  const failingSources = await db
    .select()
    .from(sources)
    .where(and(eq(sources.schoolId, school.id), gte(sources.consecutiveFailures, 3)));

  const weeklyPosts = await db
    .select()
    .from(posts)
    .where(eq(posts.schoolId, school.id))
    .orderBy(desc(posts.scheduledDate))
    .limit(6);

  const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r.count]));

  return (
    <>
      <h1>{school.name}</h1>
      <p className="subtitle">
        {school.city}, {school.state} · {school.timezone} · {school.instagramAccount}
      </p>

      <div className="stat-row">
        <div className="stat-card">
          <div className="value">{totalRow?.total ?? 0}</div>
          <div className="label">Total events</div>
        </div>
        {byCategory.slice(0, 4).map((c) => (
          <div className="stat-card" key={c.category}>
            <div className="value">{c.count}</div>
            <div className="label">{c.category.replace("_", " ")}</div>
          </div>
        ))}
        <div className="stat-card">
          <div className="value">{statusMap.rejected ?? 0}</div>
          <div className="label">Rejected</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Needs attention</h2>
          </div>
          <table>
            <tbody>
              <tr>
                <td>Events needing review</td>
                <td>
                  <a href="/events?verification=needs_review">{needsReviewCount[0]?.count ?? 0}</a>
                </td>
              </tr>
              <tr>
                <td>Events with a CONFLICT</td>
                <td>
                  <a href="/events?verification=conflict">{conflictCount[0]?.count ?? 0}</a>
                </td>
              </tr>
              <tr>
                <td>Sources failing (3+ checks)</td>
                <td>
                  {failingSources.length === 0 ? (
                    "0"
                  ) : (
                    <span className="badge badge-red">{failingSources.length}</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          {failingSources.length > 0 && (
            <div style={{ padding: "0 16px 14px" }}>
              {failingSources.map((s) => (
                <div key={s.id} style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  <strong style={{ color: "var(--red)" }}>@{s.instagramHandle ?? s.name}</strong> — FAILED LAST{" "}
                  {s.consecutiveFailures} CHECKS
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>This week's posts</h2>
            <a href="/posts">view all →</a>
          </div>
          <table>
            <tbody>
              {weeklyPosts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`/posts/${p.id}`}>{p.title}</a>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>{p.scheduledDate}</div>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[p.status] ?? "badge-muted"}`}>
                      {p.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {weeklyPosts.length === 0 && (
                <tr>
                  <td className="empty">No posts yet — run selection below.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Pipeline controls</h2>
        </div>
        <div style={{ padding: 16 }} className="btn-row">
          <form action={runProcessAction}>
            <button className="btn btn-primary" type="submit">
              Run AI processing (pending raw content)
            </button>
          </form>
          <BuildWeeklyPostsButton />
        </div>
        <p style={{ padding: "0 16px 16px", color: "var(--muted)", fontSize: 12 }}>
          In production these run automatically on a schedule (see the n8n workflows in the README) — these
          buttons are for on-demand runs during development/demo.
        </p>
      </div>
    </>
  );
}
