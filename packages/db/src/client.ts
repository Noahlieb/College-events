import "./env.js";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/college_events";

export const pool = new pg.Pool({ connectionString });
export const db = drizzle(pool, { schema });
export type Database = typeof db;
