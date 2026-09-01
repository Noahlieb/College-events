import { count, desc, eq } from "drizzle-orm";
import { db, qrCodeClicks, qrCodes } from "@college-events/db";
import { getRedirectUrl } from "@/lib/qr-links";
import { createQrCodeAction, toggleQrCodeActiveAction } from "@/lib/qr-actions";

export const dynamic = "force-dynamic";

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const rows = await db.select().from(qrCodes).orderBy(desc(qrCodes.createdAt));
  const clickCounts = await db
    .select({ qrCodeId: qrCodeClicks.qrCodeId, total: count() })
    .from(qrCodeClicks)
    .groupBy(qrCodeClicks.qrCodeId);
  const countByQrCodeId = new Map(clickCounts.map((c) => [c.qrCodeId, c.total]));

  return (
    <>
      <h1>Links &amp; QR Codes</h1>
      <p className="subtitle">
        Dynamic QR codes and short links, tracked independently of any school or event — the printed code stays
        fixed while its destination and click analytics can change any time.
      </p>

      {error && (
        <div className="panel" style={{ padding: 14, borderColor: "var(--red)" }}>
          <span className="badge badge-red">Error</span> {error}
        </div>
      )}

      <div className="panel">
        {rows.length === 0 ? (
          <div className="empty">No links yet — create one below.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Destination</th>
                <th>Redirect link</th>
                <th>Clicks</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/links/${r.id}`}>
                      <strong>{r.label}</strong>
                    </a>
                  </td>
                  <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.destinationUrl}
                  </td>
                  <td>
                    <code style={{ fontSize: 12 }}>{getRedirectUrl(r.slug)}</code>
                  </td>
                  <td>{countByQrCodeId.get(r.id) ?? 0}</td>
                  <td>
                    <form action={toggleQrCodeActiveAction.bind(null, r.id, !r.active)}>
                      <button className={`btn btn-sm ${r.active ? "" : "btn-danger"}`} type="submit">
                        {r.active ? "Active" : "Paused"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Create link</h2>
        </div>
        <form action={createQrCodeAction} style={{ padding: 16 }}>
          <label>Label</label>
          <input name="label" required placeholder="e.g. Flyer — Fall tabling" />
          <label>Destination URL</label>
          <input name="destinationUrl" required placeholder="https://..." />
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" type="submit">
              Create link
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
