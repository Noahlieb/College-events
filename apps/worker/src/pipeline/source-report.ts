import { asc, eq } from "drizzle-orm";
import { db, sources } from "@college-events/db";

/**
 * A markdown table of every source and its health, for the daily run's job
 * summary and for `pnpm worker source-report <school>`.
 *
 * This exists because "the pipeline succeeded" and "the pipeline found
 * anything" are different claims. A source that answers 200 and returns
 * nothing produces a green run and an emptier calendar, so health and last
 * yield are reported explicitly rather than inferred from step outcomes.
 */
export async function sourceReport(schoolId: string): Promise<string> {
  const rows = await db
    .select()
    .from(sources)
    .where(eq(sources.schoolId, schoolId))
    .orderBy(asc(sources.name));

  if (rows.length === 0) return "_No sources configured._";

  const icon: Record<string, string> = {
    healthy: "🟢",
    warning: "🟡",
    degraded: "🟠",
    failed: "🔴",
    disabled: "⚪️",
  };
  const ago = (d: Date | null): string => {
    if (!d) return "never";
    const hours = Math.floor((Date.now() - d.getTime()) / 3_600_000);
    if (hours < 1) return "just now";
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const lines = [
    "| Source | Adapter | Health | Last crawl | Last event | Trust |",
    "|---|---|---|---|---|---|",
    ...rows.map((s) =>
      [
        "",
        s.active ? s.name : `${s.name} _(off)_`,
        s.adapterType ?? "—",
        `${icon[s.healthStatus] ?? ""} ${s.healthStatus}`,
        ago(s.lastCheckedAt),
        ago(s.lastEventFoundAt),
        String(s.trustScore),
        "",
      ].join(" | ").trim(),
    ),
  ];

  // Degraded is called out separately so it never reads as a code defect:
  // the platform declined automated access, and other sources are expected
  // to cover those events.
  const degraded = rows.filter((s) => s.healthStatus === "degraded");
  if (degraded.length > 0) {
    lines.push("");
    lines.push(
      `🟠 **${degraded.length} source${degraded.length > 1 ? "s" : ""} degraded** — the platform declined automated access. This is its access control, not a bug, and we do not attempt to bypass it. Other sources cover these events.`,
    );
    for (const s of degraded) lines.push(`- **${s.name}**: ${s.healthReason ?? "no reason recorded"}`);
  }

  const silent = rows.filter((s) => s.active && s.healthStatus === "warning");
  if (silent.length > 0) {
    lines.push("");
    lines.push(`🟡 **${silent.length} source${silent.length > 1 ? "s" : ""} need attention**`);
    for (const s of silent) lines.push(`- **${s.name}**: ${s.healthReason ?? "no reason recorded"}`);
  }

  return lines.join("\n");
}
