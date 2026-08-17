import { eq } from "drizzle-orm";
import { db, schools } from "@college-events/db";

/**
 * MVP is single-tenant-first (spec §5): the dashboard operates on one
 * school at a time, selected via DASHBOARD_SCHOOL (defaults to FAU). Every
 * query below still filters by school_id explicitly rather than assuming
 * "the only school", so adding a school switcher later is a UI change, not
 * a data-model change.
 */
export async function getCurrentSchool() {
  const shortName = process.env.DASHBOARD_SCHOOL ?? "FAU";
  const [school] = await db.select().from(schools).where(eq(schools.shortName, shortName)).limit(1);
  if (!school) {
    throw new Error(`School "${shortName}" not found. Run "pnpm db:seed" first.`);
  }
  return school;
}
