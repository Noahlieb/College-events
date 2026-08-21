import { eq } from "drizzle-orm";
import { db, schools } from "@college-events/db";

export async function resolveSchoolId(shortName: string): Promise<string> {
  const [school] = await db.select().from(schools).where(eq(schools.shortName, shortName)).limit(1);
  if (!school) throw new Error(`No school found with short_name "${shortName}". Run "pnpm db:seed" first?`);
  return school.id;
}
