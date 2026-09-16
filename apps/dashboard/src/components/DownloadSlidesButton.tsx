"use client";

import { useState } from "react";

/**
 * Extracts the filename the server already chose (Content-Disposition:
 * attachment; filename="...") rather than guessing one client-side, so a
 * blob-URL download still lands with the same name a single "Slide N"
 * click would give it.
 */
function filenameFromContentDisposition(header: string | null, fallback: string): string {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? fallback;
}

/**
 * Triggers a save for every slide in one click.
 *
 * Previously fired all N downloads via `setTimeout` + a bare `a.click()`
 * with no verification that any of them actually succeeded — a failed
 * fetch (a stale asset row, an upstream 502) produced no downloaded file
 * and no indication anything was wrong, and browsers that rate-limit
 * multiple script-triggered downloads in quick succession (Chrome shows a
 * one-time "downloads blocked" notice, easy to miss, then silently drops
 * the rest) meant some slides just never arrived with nothing in the UI
 * to say so.
 *
 * Now awaits each download in sequence — fetches the bytes, confirms a
 * real 200 response, and only then saves via a blob URL — so a failure is
 * caught and reported by filename instead of silently missing, and
 * "started" always means "actually saved." This doesn't fully eliminate a
 * browser's own automatic-download permission prompt (that's a
 * browser-level gate no page can bypass), but it means a slide that fails
 * for any other reason shows up as a named failure instead of just being
 * one of the "missing" files nobody can explain.
 */
export function DownloadAllSlidesButton({ assetIds }: { assetIds: string[] }) {
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  const downloadAll = async () => {
    setPending(true);
    setFailures([]);
    setProgress({ done: 0, total: assetIds.length });
    const failed: string[] = [];

    for (let i = 0; i < assetIds.length; i++) {
      const id = assetIds[i]!;
      try {
        const res = await fetch(`/api/assets/${id}/download`);
        if (!res.ok) {
          failed.push(`Slide ${i + 1}`);
        } else {
          const blob = await res.blob();
          const filename = filenameFromContentDisposition(res.headers.get("content-disposition"), `slide-${id.slice(0, 8)}.jpg`);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          // Freed after the click has had a moment to hand the blob off to
          // the browser's download machinery — revoking immediately can
          // cancel the save on some browsers.
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } catch {
        failed.push(`Slide ${i + 1}`);
      }
      setProgress({ done: i + 1, total: assetIds.length });
      // Still spaced out, not because correctness depends on it now (each
      // download is verified before the next starts), but a browser's own
      // automatic-download throttling counts *how close together* saves
      // happen, not just how many — spacing them out is the one lever a
      // page has on that, on top of no longer masking real failures.
      if (i < assetIds.length - 1) await new Promise((r) => setTimeout(r, 400));
    }

    setFailures(failed);
    setPending(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <button className="btn btn-sm" type="button" onClick={downloadAll} disabled={assetIds.length === 0 || pending}>
        {pending && progress ? `Downloading… (${progress.done}/${progress.total})` : `Download all (${assetIds.length})`}
      </button>
      {failures.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--red, #e5484d)" }}>
          Failed to download: {failures.join(", ")}. Try again, or download those individually below.
        </div>
      )}
    </div>
  );
}
