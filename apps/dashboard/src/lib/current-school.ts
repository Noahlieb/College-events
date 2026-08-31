import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schools } from "@college-events/db";

export const SCHOOL_COOKIE = "dashboard_school";

/**
 * Every query in the dashboard filters by school_id explicitly rather than
 * assuming "the only school" (spec §5's multi-tenant-from-day-one data
 * model), so which school is "current" is just a matter of which one this
 * request is scoped to. The nav's school switcher (layout.tsx) sets a
 * cookie on selection; that cookie wins when present, falling back to
 * DASHBOARD_SCHOOL (defaults FAU) for a browser that's never picked one.
 */
export async function getCurrentSchool() {
  const cookieStore = await cookies();
  const shortName = cookieStore.get(SCHOOL_COOKIE)?.value || process.env.DASHBOARD_SCHOOL || "FAU";
  const [school] = await db.select().from(schools).where(eq(schools.shortName, shortName)).limit(1);
  if (!school) {
    throw new Error(`School "${shortName}" not found. Run "pnpm db:seed" first.`);
  }
  return school;
}
