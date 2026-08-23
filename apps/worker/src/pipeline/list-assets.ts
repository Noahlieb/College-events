import { asc, eq } from "drizzle-orm";
import { db, posts, renderedAssets } from "@college-events/db";

/**
 * Prints every post's rendered assets with their storage URLs.
 *
 * Exists because "the slide still shows the old text" has several causes that
 * look identical in a browser -- a stale CDN copy, a row pointing at an older
 * render, or an object that was deleted out from under a row -- and the URL
 * tells them apart at a glance. Content-addressed filenames carry a hash of
 * the bytes, so a name with no hash is proof the row predates that change.
 */
export async function listAssets(schoolId: string): Promise<void> {
  const rows = await db
    .select({
      postType: posts.postType,
      scheduledDate: posts.scheduledDate,
      template: renderedAssets.template,
      storageUrl: renderedAssets.storageUrl,
      createdAt: renderedAssets.createdAt,
    })
    .from(renderedAssets)
    .innerJoin(posts, eq(renderedAssets.postId, posts.id))
    .where(eq(posts.schoolId, schoolId))
    .orderBy(asc(posts.scheduledDate), asc(renderedAssets.createdAt));

  let current = "";
  let hashed = 0;
  for (const r of rows) {
    const key = `${r.scheduledDate} ${r.postType}`;
    if (key !== current) {
      current = key;
      console.log(`\n${key}`);
    }
    const file = r.storageUrl.split("/").pop() ?? r.storageUrl;
    // A content-addressed name looks like "rendered-v1-<12 hex>.jpg".
    const isHashed = /-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i.test(file);
    if (isHashed) hashed++;
    console.log(`   ${isHashed ? "hashed  " : "OLD PATH"}  ${file}`);
  }
  console.log(`\n${hashed}/${rows.length} assets are content-addressed (re-rendered since the fix).`);
}
