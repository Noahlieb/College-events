import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo layout: packages/db/src/env.ts -> repo root is three levels up.
config({ path: path.resolve(here, "../../../.env") });
