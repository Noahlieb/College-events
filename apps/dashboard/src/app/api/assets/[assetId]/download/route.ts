import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, renderedAssets } from "@college-events/db";
// Deep import — same reason as lib/media.ts and the /media route: pulling
// this in through the package barrel would drag sharp into Next's server
// bundle.
import { storageDir } from "@college-events/worker/dist/lib/storage.js";

/**
 * Forces a real "Save Image" instead of the browser just opening it —
 * plain `<a href={imageUrl} download>` doesn't reliably work once the
 * image lives on a different origin (Supabase Storage in production, not
 * the dashboard's own domain), which is exactly the case rendered slides
 * are normally in. Browsers are inconsistent about honoring `download`
 * cross-origin; some just navigate to the image instead. Proxying the
 * bytes through this same-origin route with an explicit
 * Content-Disposition header sidesteps that entirely, for either storage
 * backend (see lib/media.ts's own local/remote split, mirrored here).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const [asset] = await db.select().from(renderedAssets).where(eq(renderedAssets.id, assetId)).limit(1);
  if (!asset) return new NextResponse("Not found", { status: 404 });

  let bytes: Buffer;
  let contentType = "image/jpeg";

  if (/^https?:\/\//.test(asset.storageUrl)) {
    const upstream = await fetch(asset.storageUrl);
    if (!upstream.ok) return new NextResponse("Upstream fetch failed", { status: 502 });
    bytes = Buffer.from(await upstream.arrayBuffer());
    contentType = upstream.headers.get("content-type") ?? contentType;
  } else {
    const base = storageDir();
    const resolved = path.resolve(asset.storageUrl);
    if (!resolved.startsWith(base)) return new NextResponse("Not found", { status: 404 });
    try {
      bytes = await readFile(resolved);
    } catch {
      return new NextResponse("Not found", { status: 404 });
    }
  }

  const filename = `${asset.template || "slide"}-${asset.id.slice(0, 8)}.jpg`;
  // Constructed inline rather than passed as the already-typed `bytes`
  // variable: TS infers a plain, non-generic Uint8Array<ArrayBuffer> only
  // at a `new Uint8Array(...)` call site itself, which is what BodyInit
  // actually requires — a Buffer/Uint8Array held in a variable is typed
  // generically over ArrayBufferLike and doesn't satisfy it (see the
  // /media/[...path] route for the same pattern).
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
