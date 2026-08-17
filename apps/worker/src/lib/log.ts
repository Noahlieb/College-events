import { db, processingLogs } from "@college-events/db";

export async function log(
  schoolId: string | null,
  level: "debug" | "info" | "warn" | "error",
  scope: string,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const line = `[${scope}] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  await db.insert(processingLogs).values({ schoolId, level, scope, message, metadata });
}
