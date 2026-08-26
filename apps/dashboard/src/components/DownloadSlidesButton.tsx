"use client";

/**
 * Triggers a save for every slide in one click. Browsers only allow one
 * programmatic download to start per user gesture in some cases, so these
 * are kicked off with a small stagger rather than all in the same tick —
 * without it, some browsers silently drop everything after the first.
 */
export function DownloadAllSlidesButton({ assetIds }: { assetIds: string[] }) {
  const downloadAll = () => {
    assetIds.forEach((id, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = `/api/assets/${id}/download`;
        a.click();
      }, i * 300);
    });
  };

  return (
    <button className="btn btn-sm" type="button" onClick={downloadAll} disabled={assetIds.length === 0}>
      Download all ({assetIds.length})
    </button>
  );
}
