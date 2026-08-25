"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSchool } from "./current-school";
// Deep import, not the @college-events/worker barrel — see the comment
// below on why this whole file stays isolated from anything sharp-adjacent.
// select-posts.js itself never imports render.js, so pulling it in here
// doesn't reintroduce the problem this file exists to avoid.
import { selectWeeklyPosts } from "@college-events/worker/dist/pipeline/select-posts.js";

/**
 * Calls the standalone render-service Vercel Function over HTTP rather than
 * importing renderPost directly — see apps/render-service/api/render.ts for
 * why: sharp (a native addon pulled in transitively via
 * @college-events/render) could not be reliably bundled inside this
 * Next.js app's serverless output on Vercel after three different
 * config-based fixes failed. Deliberately isolated to its own file; every
 * other dashboard action lives in actions.ts and has nothing to do with
 * rendering or this HTTP call.
 */
async function callRenderService(postId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = process.env.RENDER_SERVICE_URL;
  const secret = process.env.RENDER_SERVICE_SECRET;
  if (!url || !secret) {
    return { ok: false, error: "RENDER_SERVICE_URL / RENDER_SERVICE_SECRET are not configured." };
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Render-Secret": secret },
      body: JSON.stringify({ postId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `render-service returned ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Renders one post. Used by the per-post "Render" button on /posts/[id]. */
export async function renderPostAction(postId: string) {
  const result = await callRenderService(postId);
  if (!result.ok) throw new Error(result.error);
  revalidatePath(`/posts/${postId}`);
}

export interface BuildWeeklyPostsResult {
  selected: { postId: string; postType: string; scheduledDate: string; eventCount: number }[];
  rendered: { postId: string; ok: boolean; error?: string }[];
}

/**
 * The one-click "assemble and render this week's posts" action: picks which
 * active events go in each lane's post (selectWeeklyPosts — a database-only
 * operation, always runs), then renders every resulting post's carousel
 * image via the render-service.
 *
 * Selection and rendering are reported separately and a render failure on
 * one post never stops the others — selection has already happened by the
 * time rendering starts, so a render-service outage shouldn't cost you the
 * event assignments you just made, only the images, which can be retried
 * per-post from /posts/[id] once it's back.
 */
export async function buildWeeklyPostsAction(): Promise<BuildWeeklyPostsResult> {
  const school = await getCurrentSchool();
  const selection = await selectWeeklyPosts(school.id);

  const rendered: BuildWeeklyPostsResult["rendered"] = [];
  for (const s of selection) {
    const result = await callRenderService(s.postId);
    rendered.push(result.ok ? { postId: s.postId, ok: true } : { postId: s.postId, ok: false, error: result.error });
  }

  revalidatePath("/posts");
  revalidatePath("/");

  return {
    selected: selection.map((s) => ({
      postId: s.postId,
      postType: s.postType,
      scheduledDate: s.scheduledDate,
      eventCount: s.eventCount,
    })),
    rendered,
  };
}
