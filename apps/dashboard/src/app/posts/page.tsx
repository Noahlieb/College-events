import { desc, eq, sql } from "drizzle-orm";
import { db, postEvents, posts } from "@college-events/db";
import { getCurrentSchool } from "@/lib/current-school";
import { BuildWeeklyPostsButton } from "@/components/BuildWeeklyPostsButton";
import { PostsTable } from "@/components/PostsTable";

// select-posts crosses multiple weeks and render calls an external HTTP
// service once per resulting post — comfortably past the platform's
// default function timeout for a school with several lanes and weeks.
export const maxDuration = 300;

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

      <PostsTable
        rows={rows.map(({ post, eventCount }) => ({
          id: post.id,
          postType: post.postType,
          scheduledDate: post.scheduledDate,
          title: post.title,
          eventCount,
          caption: post.caption,
          status: post.status,
        }))}
      />
    </>
  );
}
