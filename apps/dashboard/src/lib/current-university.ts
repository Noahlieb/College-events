import { eq } from "drizzle-orm";
import { db, schools } from "@college-events/db";

/**
 * Deals dashboard equivalent of current-school.ts. Same single-tenant-first
 * pattern (spec Phase 16): every query still filters by university_id
 * explicitly, so a university switcher is a UI change later, not a
 * data-model change. Defaults to UCF, the first Deals-product university.
 */
export async function getCurrentUniversity() {
  const shortName = process.env.DASHBOARD_UNIVERSITY ?? "UCF";
  const [university] = await db.select().from(schools).where(eq(schools.shortName, shortName)).limit(1);
  if (!university) {
    throw new Error(`University "${shortName}" not found. Run "pnpm db:seed:deals" first.`);
  }
  return university;
}
