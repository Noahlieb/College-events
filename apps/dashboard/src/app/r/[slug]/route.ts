import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, qrCodeClicks, qrCodes } from "@college-events/db";

export const dynamic = "force-dynamic";

/**
 * Public redirect endpoint a scanned QR code / shared link hits — deliberately
 * excluded from the dashboard's basic-auth middleware (see middleware.ts)
 * since whoever scans the code has no dashboard credentials. Logs a click
 * row (best-effort, never blocks the redirect) then 302s to the current
 * destination URL, which is what makes the QR code "dynamic": the printed
 * code never changes, only the row it points at.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [qrCode] = await db.select().from(qrCodes).where(eq(qrCodes.slug, slug)).limit(1);

  if (!qrCode || !qrCode.active) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Awaited (not fire-and-forget) — on a serverless function the process can
  // be frozen the instant the response is returned, which would drop an
  // in-flight insert and silently under-count clicks.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  try {
    await db.insert(qrCodeClicks).values({
      qrCodeId: qrCode.id,
      referrer: request.headers.get("referer"),
      userAgent: request.headers.get("user-agent"),
      ipHash: ip ? createHash("sha256").update(ip).digest("hex") : null,
    });
  } catch (err) {
    console.error(`[r/${slug}] failed to record click:`, err);
  }

  return NextResponse.redirect(qrCode.destinationUrl, { status: 302 });
}
