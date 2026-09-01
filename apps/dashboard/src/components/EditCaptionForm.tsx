"use client";

import { useState, useTransition } from "react";
import { updateCaptionAction } from "@/lib/actions";

/**
 * The caption used to be a read-only `<pre>` inside a `<details>` — there
 * was no way to fix a wrong detail or reword the AI's draft short of
 * editing the database by hand. This swaps the static text for a textarea
 * on demand, saved through the same silent-failure-safe pending/error
 * pattern as every other action button in this app (see ImportCsvForm).
 */
/** Copies `text` to the clipboard and flips to a "Copied!" label for 2s so
 * the click has visible confirmation instead of appearing to do nothing. */
function CopyCaptionButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions) —
      // silently no-op rather than showing an error for a copy button.
    }
  };

  return (
    <button className="btn btn-sm" type="button" onClick={copy} disabled={!text}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export function EditCaptionForm({ postId, caption }: { postId: string; caption: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(caption);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div>
        <pre>{caption || "(no caption generated yet)"}</pre>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" type="button" onClick={() => setEditing(true)}>
            Edit caption
          </button>
          <CopyCaptionButton text={caption} />
        </div>
      </div>
    );
  }

  const save = () => {
    setError(null);
    const formData = new FormData();
    formData.set("caption", value);
    startTransition(async () => {
      try {
        await updateCaptionAction(postId, formData);
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed — try again.");
      }
    });
  };

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={16}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 13 }}
      />
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save caption"}
        </button>
        <button
          className="btn btn-sm"
          type="button"
          disabled={pending}
          onClick={() => {
            setValue(caption);
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </button>
        <CopyCaptionButton text={value} />
        {error && <div style={{ fontSize: 12, color: "var(--red, #e5484d)" }}>{error}</div>}
      </div>
    </div>
  );
}
