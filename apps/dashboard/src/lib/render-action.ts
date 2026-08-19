"use server";

import { revalidatePath } from "next/cache";

/**
 * Calls the standalone render-service Vercel Function over HTTP rather than
 * importing renderPost directly — see apps/render-service/api/render.ts for
 * why: sharp (a native addon pulled in transitively via
 * @college-events/render) could not be reliably bundled inside this
 * Next.js app's serverless output on Vercel after three different
 * config-based fixes failed. Deliberately isolated to its own file,
 * imported only by /posts/[id] — every other dashboard action lives in
 * actions.ts and has nothing to do with rendering or this HTTP call.
 */
export async function renderPostAction(postId: string) {
  const url = process.env.RENDER_SERVICE_URL;
  const secret = process.env.RENDER_SERVICE_SECRET;
  if (!url || !secret) {
    throw new Error(
      "RENDER_SERVICE_URL / RENDER_SERVICE_SECRET are not configured — set them to the deployed render-service's URL and shared secret.",
    );
  }

  const res = await fetch(`${url.replace(/\/$/, "")}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Render-Secret": secret },
    body: JSON.stringify({ postId }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`render-service returned ${res.status}: ${body.slice(0, 500)}`);
  }

  revalidatePath(`/posts/${postId}`);
}
