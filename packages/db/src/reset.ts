import "./env.js";
import { db, pool } from "./client.js";
import { sql } from "drizzle-orm";

/** Dev-only: drops and recreates the public schema. Never run against production. */
async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset the database in production.");
  }
  console.log("Dropping and recreating public + drizzle schemas on", process.env.DATABASE_URL);
  await db.execute(sql`DROP SCHEMA public CASCADE;`);
  await db.execute(sql`CREATE SCHEMA public;`);
  // drizzle-orm's migration tracking table lives in its own "drizzle" schema —
  // drop it too so a reset actually replays migrations from scratch.
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
