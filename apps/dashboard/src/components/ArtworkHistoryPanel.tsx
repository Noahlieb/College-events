"use client";

import { useRef, useState, useTransition } from "react";
import { selectEventArtworkAction, uploadEventArtworkAction } from "@/lib/artwork-action";

export interface ArtworkHistoryItem {
  id: string;
  storageUrl: string | null;
  isOfficial: boolean;
  isAiGenerated: boolean;
  classification: string;
  origin: string | null;
  createdAt: string; // ISO
}

function labelFor(item: ArtworkHistoryItem, index: number): string {
  if (index === 0) return item.isOfficial ? "Original" : "First version";
  if (item.origin === "manual_upload") return "Uploaded";
  if (item.isAiGenerated) return "AI generated";
  return item.classification.replace(/_/g, " ");
}

/**
 * Full picture-editing surface for one event (spec follow-up: "regenerate
 * and edit and revert to original if needed"). Regeneration itself lives in
 * RegenerateArtworkForm; this panel covers the other two asks:
 *
 *  - "edit": upload a replacement image directly, bypassing AI entirely.
 *  - "revert to original": every image this event has ever had — the
 *    original scraped flyer, every past AI generation, every upload — is
 *    already preserved in storage (content-addressed paths never get
 *    overwritten), so reverting is just pointing back at an old row, not a
 *    new generation.
 */
export function ArtworkHistoryPanel({
  eventId,
  canonicalAssetId,
  history,
}: {
  eventId: string;
  canonicalAssetId: string | null;
  history: ArtworkHistoryItem[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const useVersion = (assetId: string) => {
    setError(null);
    setMessage(null);
    setPendingId(assetId);
    startTransition(async () => {
      try {
        const result = await selectEventArtworkAction(eventId, assetId);
        if (result.action === "skipped") setError(result.reason);
        else setMessage("Switched to that version.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't switch versions — try again.");
      } finally {
        setPendingId(null);
      }
    });
  };

  const upload = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose an image file first.");
      return;
    }
    setError(null);
    setMessage(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      try {
        const result = await uploadEventArtworkAction(eventId, formData);
        if (result.action === "skipped") setError(result.reason);
        else {
          setMessage("Uploaded — this image now takes priority over AI regeneration for this event.");
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed — try again.");
      }
    });
  };

  return (
    <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
      <label>Upload your own image (edit)</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ width: "auto" }} />
        <button className="btn btn-sm" type="button" onClick={upload} disabled={pending}>
          {pending && pendingId === null ? "Uploading…" : "Upload replacement"}
        </button>
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
        Replaces the picture only, same as regenerating — an uploaded image counts as an official visual, so it
        sticks and AI won't overwrite it later.
      </p>

      {history.length > 0 && (
        <>
          <label style={{ marginTop: 16 }}>Version history — click one to use it</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {history.map((item, index) => {
              const isCurrent = item.id === canonicalAssetId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => !isCurrent && useVersion(item.id)}
                  disabled={pending || isCurrent}
                  title={`${labelFor(item, index)} · ${new Date(item.createdAt).toLocaleString()}`}
                  style={{
                    padding: 0,
                    border: isCurrent ? "2px solid var(--accent)" : "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--panel-alt)",
                    cursor: isCurrent ? "default" : "pointer",
                    width: 76,
                    overflow: "hidden",
                    opacity: pending && pendingId === item.id ? 0.5 : 1,
                  }}
                >
                  {item.storageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.storageUrl} alt="" style={{ width: 74, height: 74, objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ width: 74, height: 74, background: "var(--panel-alt)" }} />
                  )}
                  <div style={{ fontSize: 9, padding: "2px 4px", color: isCurrent ? "var(--accent)" : "var(--muted)" }}>
                    {isCurrent ? "current" : labelFor(item, index)}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--red, #e5484d)" }}>{error}</div>}
      {message && !error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>{message}</div>}
    </div>
  );
}
