import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root regardless of the caller's cwd (apps/worker/src/lib -> repo root
// is 4 levels up), so storage_url is a stable absolute path any process —
// worker CLI, dashboard, a future n8n job — can resolve the same way.
const REPO_ROOT = path.resolve(here, "../../../../");

function resolveStorageDir(): string {
  const configured = process.env.LOCAL_STORAGE_DIR ?? "./storage";
  return path.isAbsolute(configured) ? configured : path.resolve(REPO_ROOT, configured);
}

let supabaseClient: SupabaseClient | null | undefined;

/** Lazily built and cached — undefined means "not configured, use local disk." */
function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient !== undefined) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  supabaseClient = url && key ? createClient(url, key) : null;
  return supabaseClient;
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Deterministic storage path per spec §35, e.g.
 * schools/fau/events/{eventId}/rendered-v1.jpg
 */
export function assetPath(schoolShortName: string, ...segments: string[]): string {
  return path.join("schools", schoolShortName.toLowerCase(), ...segments);
}

/**
 * Writes a rendered asset and returns its storage_url. When Supabase is
 * configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set), uploads to the
 * SUPABASE_STORAGE_BUCKET bucket and returns the public URL — this is
 * required for production/Vercel, where local disk is ephemeral and not
 * shared across serverless invocations. Falls back to local disk (returning
 * an absolute file path) for local dev when Supabase isn't configured.
 * Uploads use upsert so re-rendering a post is safe/idempotent, matching
 * renderPost()'s "clear and rebuild" behavior.
 */
export async function saveAsset(relativePath: string, buffer: Buffer): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "college-events-media";
    const storagePath = relativePath.split(path.sep).join("/");
    const contentType = CONTENT_TYPES[path.extname(relativePath).toLowerCase()] ?? "application/octet-stream";
    const { error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, { contentType, upsert: true });
    if (error) {
      throw new Error(`Supabase Storage upload failed for "${storagePath}" (bucket "${bucket}"): ${error.message}`);
    }
    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    return data.publicUrl;
  }

  const fullPath = path.join(resolveStorageDir(), relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
  return fullPath;
}

export function storageDir(): string {
  return resolveStorageDir();
}
