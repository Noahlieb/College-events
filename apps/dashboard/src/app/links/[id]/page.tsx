import { and, count, desc, eq, gte } from "drizzle-orm";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db, qrCodeClicks, qrCodes } from "@college-events/db";
import { getRedirectUrl } from "@/lib/qr-links";
import { deleteQrCodeAction, toggleQrCodeActiveAction, updateDestinationAction } from "@/lib/qr-actions";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function LinkDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const [qrCode] = await db.select().from(qrCodes).where(eq(qrCodes.id, id)).limit(1);
  if (!qrCode) notFound();

  const redirectUrl = getRedirectUrl(qrCode.slug);
  const qrImageDataUrl = await QRCode.toDataURL(redirectUrl, { width: 320, margin: 1 });

  const since7d = new Date(Date.now() - 7 * DAY_MS);
  const since30d = new Date(Date.now() - 30 * DAY_MS);

  const [[totalRow], [last7Row], [last30Row], recentClicks] = await Promise.all([
    db.select({ total: count() }).from(qrCodeClicks).where(eq(qrCodeClicks.qrCodeId, id)),
    db
      .select({ total: count() })
      .from(qrCodeClicks)
      .where(and(eq(qrCodeClicks.qrCodeId, id), gte(qrCodeClicks.clickedAt, since7d))),
    db
      .select({ total: count() })
      .from(qrCodeClicks)
      .where(and(eq(qrCodeClicks.qrCodeId, id), gte(qrCodeClicks.clickedAt, since30d))),
    db
      .select()
      .from(qrCodeClicks)
      .where(eq(qrCodeClicks.qrCodeId, id))
      .orderBy(desc(qrCodeClicks.clickedAt))
      .limit(25),
  ]);

  return (
    <>
      <p>
        <a href="/links">← back to links</a>
      </p>
      <h1>{qrCode.label}</h1>
      <p className="subtitle">
        <span className={`badge ${qrCode.active ? "badge-green" : "badge-muted"}`}>
          {qrCode.active ? "Active" : "Paused"}
        </span>{" "}
        · created {qrCode.createdAt.toLocaleDateString()}
      </p>

      {error && (
        <div className="panel" style={{ padding: 14, borderColor: "var(--red)" }}>
          <span className="badge badge-red">Error</span> {error}
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>QR code</h2>
          </div>
          <div style={{ padding: 16, textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrImageDataUrl} alt={`QR code for ${qrCode.label}`} width={240} height={240} />
            <p style={{ marginTop: 10 }}>
              <a href={qrImageDataUrl} download={`${qrCode.slug}.png`} className="btn btn-sm">
                Download PNG
              </a>
            </p>
            <p style={{ marginTop: 10 }}>
              <code style={{ fontSize: 12 }}>{redirectUrl}</code>
            </p>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              The printed code always points at this redirect link — change the destination below any time without
              reprinting.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 style={{ margin: 0 }}>Analytics</h2>
          </div>
          <div className="stat-row" style={{ padding: 16, marginBottom: 0 }}>
            <div className="stat-card">
              <div className="value">{totalRow?.total ?? 0}</div>
              <div className="label">Total clicks</div>
            </div>
            <div className="stat-card">
              <div className="value">{last7Row?.total ?? 0}</div>
              <div className="label">Last 7 days</div>
            </div>
            <div className="stat-card">
              <div className="value">{last30Row?.total ?? 0}</div>
              <div className="label">Last 30 days</div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Destination</h2>
        </div>
        <form action={updateDestinationAction.bind(null, qrCode.id)} style={{ padding: 16 }}>
          <label>Label</label>
          <input name="label" required defaultValue={qrCode.label} />
          <label>Destination URL</label>
          <input name="destinationUrl" required defaultValue={qrCode.destinationUrl} />
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" type="submit">
              Save changes
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Recent scans</h2>
        </div>
        {recentClicks.length === 0 ? (
          <div className="empty">No scans recorded yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Referrer</th>
                <th>User agent</th>
              </tr>
            </thead>
            <tbody>
              {recentClicks.map((c) => (
                <tr key={c.id}>
                  <td>{c.clickedAt.toLocaleString()}</td>
                  <td>{c.referrer ?? "—"}</td>
                  <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.userAgent ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Danger zone</h2>
        </div>
        <div className="btn-row" style={{ padding: 16 }}>
          <form action={toggleQrCodeActiveAction.bind(null, qrCode.id, !qrCode.active)}>
            <button className="btn btn-sm" type="submit">
              {qrCode.active ? "Pause link" : "Reactivate link"}
            </button>
          </form>
          <form action={deleteQrCodeAction.bind(null, qrCode.id)}>
            <button className="btn btn-sm btn-danger" type="submit">
              Delete permanently
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
