import "./env.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

async function main() {
  console.log("Running migrations against", process.env.DATABASE_URL);
  await migrate(db, { migrationsFolder: "./src/migrations" });
  console.log("Migrations complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
