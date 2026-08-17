import { desc, eq } from "drizzle-orm";
import { db, sources } from "@college-events/db";
import { SOURCE_CATEGORIES, SOURCE_TYPES } from "@college-events/core";
import { getCurrentSchool } from "@/lib/current-school";
import { addSourceAction, toggleSourceActiveAction } from "@/lib/actions";

export default async function SourcesPage() {
  const school = await getCurrentSchool();
  const rows = await db.select().from(sources).where(eq(sources.schoolId, school.id)).orderBy(desc(sources.priority));

  return (
    <>
      <h1>Sources</h1>
      <p className="subtitle">
        {rows.length} sources configured for {school.shortName}. Sources drive discovery — no code changes needed to
        add one.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Health</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {s.url ?? (s.instagramHandle ? `@${s.instagramHandle}` : "—")}
                  </div>
                </td>
                <td>{s.sourceType.replace(/_/g, " ")}</td>
                <td>{s.category.replace(/_/g, " ")}</td>
                <td>{s.priority}</td>
                <td>
                  {s.consecutiveFailures >= 3 ? (
                    <span className="badge badge-red">FAILED LAST {s.consecutiveFailures} CHECKS</span>
                  ) : s.lastSuccessfulCheckAt ? (
                    <span className="badge badge-green">OK</span>
                  ) : (
                    <span className="badge badge-muted">not checked yet</span>
                  )}
                </td>
                <td>
                  <form action={toggleSourceActiveAction.bind(null, s.id, !s.active)}>
                    <button className={`btn btn-sm ${s.active ? "" : "btn-danger"}`} type="submit">
                      {s.active ? "Active" : "Inactive"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Add source</h2>
        </div>
        <form action={addSourceAction} style={{ padding: 16 }}>
          <div className="grid-2">
            <div>
              <label>Name</label>
              <input name="name" required placeholder="e.g. The Break Boca" />
              <label>URL</label>
              <input name="url" placeholder="https://..." />
              <label>Instagram handle (no @)</label>
              <input name="instagramHandle" placeholder="thebreakboca" />
            </div>
            <div>
              <label>Source type</label>
              <select name="sourceType" defaultValue="generic_webpage">
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <label>Category</label>
              <select name="category" defaultValue="nearby">
                {SOURCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <label>Priority (1-10)</label>
              <input name="priority" type="number" min={1} max={10} defaultValue={5} />
              <label>Scrape frequency (minutes)</label>
              <input name="scrapeFrequencyMinutes" type="number" min={0} defaultValue={360} />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" type="submit">
              Add source
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
