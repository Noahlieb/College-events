import { and, asc, eq } from "drizzle-orm";
import { db, sources } from "@college-events/db";
import { getCurrentSchool } from "@/lib/current-school";
import { ImportCsvForm } from "@/components/ImportCsvForm";

export const dynamic = "force-dynamic";
// A few hundred rows means a few hundred sequential submitManualEvent()
// calls — comfortably past the platform's default function timeout. See
// the same reasoning on the Sources page's Discover Sources button.
export const maxDuration = 300;

interface CsvImportSummary {
  totalRows: number;
  created: number;
  merged: number;
  parseErrors: { rowNumber: number; reason: string }[];
  submitErrors: { rowNumber: number; eventName: string; reason: string }[];
  routingErrors: { rowNumber: number; university: string; reason: string }[];
  bySchool: { schoolId: string; schoolShortName: string; created: number; merged: number }[];
  /** How many more of each error type exist beyond what's listed — the
   * redirect URL can only carry so much detail before hitting the
   * platform's URL length limit, so a large CSV's error list is capped
   * server-side (see toUrlSafeSummary in lib/actions.ts). Counts above are
   * always exact; only these lists are ever shortened. */
  parseErrorsTruncated?: number;
  submitErrorsTruncated?: number;
  routingErrorsTruncated?: number;
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string; error?: string }>;
}) {
  const params = await searchParams;
  let summary: CsvImportSummary | null = null;
  if (params.result) {
    try {
      summary = JSON.parse(params.result);
    } catch {
      // fall through — malformed result is treated the same as no result
    }
  }

  const school = await getCurrentSchool();
  // Ordered to match importCsvEvents()'s own fallback (apps/worker/src/pipeline/csv-import.ts) —
  // the oldest manual_submission source is what actually gets used when sourceName is omitted,
  // so the "Default" label below has to reflect that same ordering, not an arbitrary one.
  const manualSources = await db
    .select()
    .from(sources)
    .where(and(eq(sources.schoolId, school.id), eq(sources.sourceType, "manual_submission")))
    .orderBy(asc(sources.createdAt));

  return (
    <>
      <h1>Import events from CSV</h1>
      <p className="subtitle">
        Bulk-add events from a spreadsheet export. Each row runs through the same scoring and dedup logic as a
        single manual entry, then lands on the Events tab as <code>needs review</code> — nothing goes live until you
        Approve it there.
      </p>

      {params.error && (
        <div className="panel" style={{ padding: 16, borderColor: "var(--red)" }}>
          <span className="badge badge-red">IMPORT FAILED</span>
          <p style={{ margin: "10px 0 0" }}>{params.error}</p>
        </div>
      )}

      {summary && (
        <div className="panel">
          <div className="panel-header">
            <h2>Last import result</h2>
          </div>
          <div className="stat-row" style={{ padding: 16, marginBottom: 0 }}>
            <div className="stat-card">
              <div className="value">{summary.totalRows}</div>
              <div className="label">Rows in file</div>
            </div>
            <div className="stat-card">
              <div className="value">{summary.created}</div>
              <div className="label">New events</div>
            </div>
            <div className="stat-card">
              <div className="value">{summary.merged}</div>
              <div className="label">Merged (already existed)</div>
            </div>
            <div className="stat-card">
              <div className="value">
                {summary.parseErrors.length + summary.submitErrors.length + (summary.routingErrors?.length ?? 0)}
              </div>
              <div className="label">Skipped</div>
            </div>
          </div>
          {summary.bySchool && summary.bySchool.length > 1 && (
            <div style={{ padding: "0 16px 16px" }}>
              <h2 className="section-label" style={{ marginBottom: 8 }}>
                By university
              </h2>
              <div className="flags" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                {summary.bySchool.map((s) => (
                  <span className="flag-pill" key={s.schoolId}>
                    {s.schoolShortName}: {s.created} new, {s.merged} merged
                  </span>
                ))}
              </div>
            </div>
          )}
          {(summary.parseErrors.length > 0 || summary.submitErrors.length > 0 || (summary.routingErrors?.length ?? 0) > 0) && (
            <div style={{ padding: "0 16px 16px" }}>
              <h2 className="section-label" style={{ marginBottom: 8 }}>
                Skipped rows
              </h2>
              <div className="flags" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                {summary.parseErrors.map((e) => (
                  <span className="flag-pill" key={`parse-${e.rowNumber}`}>
                    Row {e.rowNumber}: {e.reason}
                  </span>
                ))}
                {(summary.routingErrors ?? []).map((e) => (
                  <span className="flag-pill" key={`route-${e.rowNumber}`}>
                    Row {e.rowNumber} (University: {e.university}): {e.reason}
                  </span>
                ))}
                {summary.submitErrors.map((e) => (
                  <span className="flag-pill" key={`submit-${e.rowNumber}`}>
                    Row {e.rowNumber} ({e.eventName}): {e.reason}
                  </span>
                ))}
              </div>
              {(summary.parseErrorsTruncated || summary.submitErrorsTruncated || summary.routingErrorsTruncated) ? (
                <p style={{ marginTop: 10, marginBottom: 0, fontSize: 13, color: "var(--muted)" }}>
                  +{(summary.parseErrorsTruncated ?? 0) + (summary.submitErrorsTruncated ?? 0) + (summary.routingErrorsTruncated ?? 0)}{" "}
                  more skipped rows not shown here — the counts above are exact, this list is just capped so the
                  page can load. For the rest of the reasons, run the same file through{" "}
                  <code>pnpm worker import-csv &lt;school&gt; &lt;file&gt;</code> instead, which prints every row.
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h2>Upload a CSV</h2>
        </div>
        <ImportCsvForm manualSources={manualSources} />
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Expected columns</h2>
        </div>
        <div style={{ padding: 16, fontSize: 13, color: "var(--muted)" }}>
          <p style={{ marginTop: 0 }}>Column names are matched case-insensitively; only Date, Time, and Event are required.</p>
          <table>
            <thead>
              <tr>
                <th>Column</th>
                <th>Required</th>
                <th>Format</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Date</td>
                <td>Yes</td>
                <td>
                  <code>YYYY-MM-DD</code>
                </td>
              </tr>
              <tr>
                <td>Time (ET)</td>
                <td>Yes</td>
                <td>
                  <code>9:00 AM</code> or <code>9:00 AM–11:00 AM</code>
                </td>
              </tr>
              <tr>
                <td>Event</td>
                <td>Yes</td>
                <td>event name</td>
              </tr>
              <tr>
                <td>Category</td>
                <td>No</td>
                <td>campus, sports, nightlife, concert, … — falls back to a keyword guess from the name/notes</td>
              </tr>
              <tr>
                <td>Presenter/Team</td>
                <td>No</td>
                <td>organization — also used to detect campus affiliation</td>
              </tr>
              <tr>
                <td>Venue</td>
                <td>No</td>
                <td>
                  <code>Venue Name, City</code>
                </td>
              </tr>
              <tr>
                <td>Notes</td>
                <td>No</td>
                <td>free text — &quot;21+&quot; and &quot;Recurring&quot; are detected automatically</td>
              </tr>
              <tr>
                <td>Image URL</td>
                <td>No</td>
                <td>used as the event photo, both in the Events tab preview and the rendered carousel</td>
              </tr>
              <tr>
                <td>Link</td>
                <td>No</td>
                <td>the event&apos;s own page — stored as its source link</td>
              </tr>
              <tr>
                <td>University</td>
                <td>No</td>
                <td>
                  short name or full name (e.g. <code>UCF</code>) — routes that row to a different school than the
                  one you&apos;re uploading from, so one file can cover several universities at once. Leave blank on
                  every row for a single-school upload; a value that doesn&apos;t match any known school is skipped
                  and reported, never guessed.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
