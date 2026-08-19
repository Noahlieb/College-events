"use server";

import { revalidatePath } from "next/cache";
// Deliberately isolated in its own file, imported only by the one page that
// needs it (/posts/[id]) — renderPost pulls in sharp (a native addon)
// transitively via @college-events/render. That dependency is confined to
// this one route on purpose: every other dashboard action (approve, reject,
// schedule, CSV import, etc.) is defined in actions.ts and never touches
// sharp at all, so a problem specific to rendering can't take down routes
// that have nothing to do with it. See actions.ts's top-of-file comment for
// the full story of why that separation matters on Vercel specifically.
import { renderPost } from "@college-events/worker/dist/pipeline/render.js";

export async function renderPostAction(postId: string) {
  await renderPost(postId);
  revalidatePath(`/posts/${postId}`);
}
