import { randomBytes } from "node:crypto";

/** Unambiguous charset for slugs — no 0/O or 1/l/I mixups when read off a printed code. */
const SLUG_ALPHABET = "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const SLUG_LENGTH = 7;

export function generateSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let slug = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return slug;
}

/** True for a Postgres unique-constraint violation (error code 23505) — used to retry slug generation on collision. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "23505";
}

/**
 * Base URL the redirect link is built on. APP_BASE_URL should be set in
 * production (the dashboard's own public URL); VERCEL_URL is a same-deploy
 * fallback, and localhost covers local dev.
 */
export function getAppBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.DASHBOARD_PORT ?? "3000"}`;
}

export function getRedirectUrl(slug: string): string {
  return `${getAppBaseUrl()}/r/${slug}`;
}
