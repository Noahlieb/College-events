import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { db, schools } from "@college-events/db";

/**
 * Which university the dashboard is currently showing.
 *
 * Every query already filtered by `school_id` rather than assuming a
 * single tenant, so making this switchable is the UI change that was
 * always implied. Selection lives in a cookie so it survives navigation
 * without putting a university id in every URL; DASHBOARD_SCHOOL remains
 * the default for a single-tenant deployment.
 */
export const SCHOOL_COOKIE = "ce_school";

export async function listUniversities() {
  return db.select().from(schools).orderBy(asc(schools.name));
}

export async function getCurrentSchool() {
  const store = await cookies();
  const selected = store.get(SCHOOL_COOKIE)?.value;

  if (selected) {
    const [school] = await db.select().from(schools).where(eq(schools.id, selected)).limit(1);
    // A stale cookie (university deleted, different environment) falls
    // through to the default rather than erroring the whole page.
    if (school) return school;
  }

  const shortName = process.env.DASHBOARD_SCHOOL ?? "FAU";
  const [fallback] = await db.select().from(schools).where(eq(schools.shortName, shortName)).limit(1);
  if (fallback) return fallback;

  // Last resort: whichever university exists. Better than a hard error on
  // a fresh install whose first university is not named FAU.
  const [first] = await db.select().from(schools).orderBy(asc(schools.createdAt)).limit(1);
  if (!first) {
    throw new Error('No universities exist yet. Run "pnpm db:seed", or add one from the Sources page.');
  }
  return first;
}
