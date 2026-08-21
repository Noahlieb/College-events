import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
// Deep import — see lib/media.ts for why this must not go through the
// package barrel (which would drag sharp into Next's server bundle).
import { storageDir } from "@college-events/worker/dist/lib/storage.js";

/** Serves locally-rendered assets in dev/demo (see lib/media.ts). Guards
 * against path traversal by requiring the resolved path stay inside the
 * configured storage directory. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const base = storageDir();
  const resolved = path.resolve(base, ...segments);
  if (!resolved.startsWith(base)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const file = await readFile(resolved);
    return new NextResponse(new Uint8Array(file), { headers: { "Content-Type": "image/jpeg" } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
