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
 *
 * Every re-render overwrites the same storage path (upsert, per
 * apps/worker/src/lib/storage.ts) so the URL never changes — which means a
 * browser (and Supabase Storage's own CDN) will happily keep showing the
 * old cached image after a re-render unless the URL itself changes. Pass
 * `cacheBust` (renderedAssets.id, which is fresh on every render) to force
 * a new URL each time.
 */
export function toDisplayUrl(storageUrl: string, cacheBust?: string): string {
  const url = /^https?:\/\//.test(storageUrl) ? storageUrl : `/media/${path.relative(storageDir(), storageUrl).split(path.sep).join("/")}`;
  if (!cacheBust) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheBust)}`;
}
