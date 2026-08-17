import path from "node:path";
// Deep import, not the package barrel: the barrel also re-exports the
// render pipeline, which pulls in sharp (a native addon) and breaks when
// Next's server bundler tries to trace/bundle it. storage.ts itself has no
// such dependency, so importing it directly avoids the whole problem.
import { storageDir } from "@college-events/worker/dist/lib/storage.js";

/**
 * Rendered assets are stored either as a real public URL (Supabase Storage
 * in production) or a local absolute filesystem path (dev/demo). This maps
 * either into something an <img> tag can load — a passthrough for real
 * URLs, or a /media/... route for local paths.
 */
export function toDisplayUrl(storageUrl: string): string {
  if (/^https?:\/\//.test(storageUrl)) return storageUrl;
  const relative = path.relative(storageDir(), storageUrl).split(path.sep).join("/");
  return `/media/${relative}`;
}
