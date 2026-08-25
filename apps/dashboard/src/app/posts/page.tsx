import { desc, eq } from "drizzle-orm";
import { db, postEvents, posts } from "@college-events/db";
import { sql } from "drizzle-orm";
import { getCurrentSchool } from "@/lib/current-school";
import { BuildWeeklyPostsButton } from "@/components/BuildWeeklyPostsButton";

// select-posts crosses multiple weeks and render calls an external HTTP
// service once per resulting post — comfortably past the platform's
// default function timeout for a school with several lanes and weeks.
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

const POST_TYPE_LABEL: Record<string, string> = {
  monday_campus: "Monday — Campus",
  midweek_activities: "Midweek — Things To Do",
  thursday_nightlife: "Thursday — Weekend Guide",
  custom: "Custom",
};

export const dynamic = "force-dynamic";

export default async function PostsPage() {
  const school = await getCurrentSchool();

  const rows = await db
    .select({ post: posts, eventCount: sql<number>`count(${postEvents.eventId})::int` })
    .from(posts)
    .leftJoin(postEvents, eq(postEvents.postId, posts.id))
    .where(eq(posts.schoolId, school.id))
    .groupBy(posts.id)
    .orderBy(desc(posts.scheduledDate));

  return (
    <>
      <h1>Weekly posts</h1>
      <p className="subtitle">Each post is a full Instagram carousel — cover slide plus one slide per event.</p>

      <div className="panel" style={{ padding: 16 }}>
        <BuildWeeklyPostsButton />
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Post</th>
              <th>Date</th>
              <th>Slides</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ post, eventCount }) => (
              <tr key={post.id}>
                <td>
                  <strong>{POST_TYPE_LABEL[post.postType] ?? post.postType}</strong>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{post.title}</div>
                </td>
                <td>{post.scheduledDate}</td>
                <td>{eventCount}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[post.status] ?? "badge-muted"}`}>
                    {post.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td>
                  <a className="btn btn-sm" href={`/posts/${post.id}`}>
                    Open
                  </a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No posts yet. Click "Build this week's posts" above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
