import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root regardless of the caller's cwd (apps/worker/src/lib -> repo root
// is 4 levels up), so storage_url is a stable absolute path any process —
// worker CLI, dashboard, a future n8n job — can resolve the same way.
const REPO_ROOT = path.resolve(here, "../../../../");

function resolveStorageDir(): string {
  const configured = process.env.LOCAL_STORAGE_DIR ?? "./storage";
  return path.isAbsolute(configured) ? configured : path.resolve(REPO_ROOT, configured);
}

/**
 * Deterministic storage path per spec §35, e.g.
 * schools/fau/events/{eventId}/rendered-v1.jpg
 */
export function assetPath(schoolShortName: string, ...segments: string[]): string {
  return path.join("schools", schoolShortName.toLowerCase(), ...segments);
}

/**
 * Writes an asset to local disk and returns its storage_url as an absolute
 * path. In production (SUPABASE_URL set) this same call site should instead
 * upload to Supabase Storage and return the public URL — swap the
 * implementation here without touching any caller, same pattern as the
 * AI/scheduler provider factories.
 */
export async function saveAsset(relativePath: string, buffer: Buffer): Promise<string> {
  const fullPath = path.join(resolveStorageDir(), relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
  return fullPath;
}

export function storageDir(): string {
  return resolveStorageDir();
}
