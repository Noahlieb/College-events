"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, qrCodes } from "@college-events/db";
import { generateSlug, isUniqueViolation } from "./qr-links";

const MAX_SLUG_ATTEMPTS = 5;

export async function createQrCodeAction(formData: FormData) {
  const label = String(formData.get("label") || "").trim();
  const destinationUrl = String(formData.get("destinationUrl") || "").trim();
  if (!label || !destinationUrl) {
    redirect("/links?error=" + encodeURIComponent("Label and destination URL are required."));
  }
  try {
    new URL(destinationUrl);
  } catch {
    redirect("/links?error=" + encodeURIComponent("Destination URL must be a valid absolute URL."));
  }

  let created: { id: string } | undefined;
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    try {
      [created] = await db
        .insert(qrCodes)
        .values({ label, destinationUrl, slug: generateSlug() })
        .returning({ id: qrCodes.id });
      break;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_SLUG_ATTEMPTS - 1) continue;
      throw err;
    }
  }

  revalidatePath("/links");
  if (created) redirect(`/links/${created.id}`);
}

export async function updateDestinationAction(qrCodeId: string, formData: FormData) {
  const destinationUrl = String(formData.get("destinationUrl") || "").trim();
  const label = String(formData.get("label") || "").trim();
  if (!label || !destinationUrl) {
    redirect(`/links/${qrCodeId}?error=` + encodeURIComponent("Label and destination URL are required."));
  }
  try {
    new URL(destinationUrl);
  } catch {
    redirect(`/links/${qrCodeId}?error=` + encodeURIComponent("Destination URL must be a valid absolute URL."));
  }

  await db.update(qrCodes).set({ label, destinationUrl, updatedAt: new Date() }).where(eq(qrCodes.id, qrCodeId));
  revalidatePath("/links");
  revalidatePath(`/links/${qrCodeId}`);
}

export async function toggleQrCodeActiveAction(qrCodeId: string, active: boolean) {
  await db.update(qrCodes).set({ active, updatedAt: new Date() }).where(eq(qrCodes.id, qrCodeId));
  revalidatePath("/links");
  revalidatePath(`/links/${qrCodeId}`);
}

export async function deleteQrCodeAction(qrCodeId: string) {
  await db.delete(qrCodes).where(eq(qrCodes.id, qrCodeId));
  revalidatePath("/links");
  redirect("/links");
}
