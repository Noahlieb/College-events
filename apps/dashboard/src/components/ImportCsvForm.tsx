"use client";

import { useRef, useState, useTransition } from "react";
import { importCsvAction } from "@/lib/actions";

/**
 * Next's own `isRedirectError` isn't part of `next/navigation`'s public
 * export surface in this Next.js version — it lives under an internal path
 * this app shouldn't depend on. A redirect() error's actual, documented
 * contract is a `digest` string starting with "NEXT_REDIRECT" (that's what
 * Next's own internal helper checks), so this checks the same thing without
 * importing framework internals.
 */
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

/**
 * A plain `<form action={importCsvAction}>` gives zero feedback while the
 * import runs, and none at all on a timeout — the click just silently does
 * nothing. That's a real risk here: importCsvEvents() runs every row
 * through submitManualEvent() one at a time, and a few hundred rows is
 * easily tens of seconds of sequential database round trips.
 *
 * importCsvAction still calls redirect() on completion — that's what makes
 * `pnpm worker import-csv`'s and a plain HTML form's behavior match. Calling
 * it directly from a client component means catching that redirect's thrown
 * signal is unavoidable; isRedirectError is what tells it apart from an
 * actual failure so a successful import still navigates instead of being
 * reported as an error.
 */
export function ImportCsvForm({ manualSources }: { manualSources: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await importCsvAction(formData);
      } catch (err) {
        if (isRedirectError(err)) throw err; // the successful-import path — let it navigate
        setError(
          err instanceof Error
            ? err.message
            : "Import didn't finish — it may have timed out. Try `pnpm worker import-csv <school> <file>` from a terminal instead, which has no time limit.",
        );
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} style={{ padding: 16 }} encType="multipart/form-data">
      <label>CSV file</label>
      <input type="file" name="csvFile" accept=".csv" required />
      <label>Submitted by (optional)</label>
      <input type="text" name="submittedBy" placeholder="your name or team" />
      {manualSources.length > 1 && (
        <>
          <label>Source</label>
          <select name="sourceName" defaultValue="">
            <option value="">Default ({manualSources[0]!.name})</option>
            {manualSources.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </>
      )}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Importing… (can take a few minutes for a large file)" : "Import CSV"}
        </button>
        {error && (
          <div style={{ fontSize: 12, color: "var(--red, #e5484d)", maxWidth: 480 }}>{error}</div>
        )}
      </div>
    </form>
  );
}
