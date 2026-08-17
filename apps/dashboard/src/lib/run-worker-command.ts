import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
// apps/dashboard/src/lib -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(here, "../../../../");

/**
 * Runs a worker CLI command as a subprocess rather than importing the
 * pipeline in-process. Image rendering pulls in sharp (a native addon),
 * which does not play well with Next.js's webpack/RSC bundling — isolating
 * it in the worker process (its actual intended runtime, per the
 * architecture: dashboard triggers jobs, worker executes them) sidesteps
 * that entirely instead of fighting the bundler.
 */
export async function runWorkerCommand(...args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("pnpm", ["--filter", "@college-events/worker", "start", ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stderr) console.error(`[worker:${args[0]}]`, stderr);
  return stdout;
}
