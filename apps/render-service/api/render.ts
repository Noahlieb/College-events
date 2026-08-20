import type { VercelRequest, VercelResponse } from "@vercel/node";
import { renderPost } from "@college-events/worker/dist/pipeline/render.js";

/**
 * Standalone Vercel Function (NOT part of the Next.js dashboard's build) for
 * rendering a post's carousel. Lives in its own project deliberately: sharp
 * (pulled in transitively via @college-events/render) could not be reliably
 * bundled inside the Next.js app's serverless output — three different
 * config-based fixes (pnpm version override + webpack externals,
 * outputFileTracingIncludes, isolating the import to one route) all failed
 * to make "Cannot find module 'sharp'" go away there. Vercel's plain
 * Node.js Function builder (used here, not Next's App Router bundling)
 * handles native addons like sharp reliably — it's the same underlying
 * mechanism next/image's own built-in sharp usage depends on.
 *
 * The dashboard's render-action.ts calls this over HTTP instead of
 * importing renderPost directly.
 */
// TEMPORARY diagnostic marker — bump this string on every deploy under
// investigation so we can prove, from the response body itself (not logs,
// which have been unreliable here), exactly which build actually served a
// given request.
const BUILD_MARKER = "font-fix-diagnostic-2026-08-20-01";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.error(`[render.ts] handler invoked, BUILD_MARKER=${BUILD_MARKER}`);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = req.headers["x-render-secret"];
  const expected = process.env.RENDER_SERVICE_SECRET;
  if (!expected || secret !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { postId } = (req.body ?? {}) as { postId?: unknown };
  if (!postId || typeof postId !== "string") {
    res.status(400).json({ error: "postId (string) is required in the request body" });
    return;
  }

  try {
    const result = await renderPost(postId);
    res.status(200).json({ ...result, buildMarker: BUILD_MARKER });
  } catch (err) {
    // console.error so Vercel's runtime logs actually capture this, not just
    // the JSON response body — the previous version only did the latter,
    // which left "No logs found for this request" with no stack trace to
    // debug from. err.stack is included in the response too (temporary,
    // while diagnosing) since this endpoint is already secret-protected.
    console.error("renderPost failed:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}
