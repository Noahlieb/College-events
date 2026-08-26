"use client";

import { useState, useTransition } from "react";
import { regenerateArtworkAction } from "@/lib/artwork-action";

const ACTION_MESSAGE: Record<string, (reason: string) => string> = {
  generated: (reason) => `New AI artwork generated. ${reason}`,
  selected_official: () =>
    "This event has a real source flyer, so AI generation is skipped — an official image always wins over a generated one. Remove or replace the source flyer first if you want AI art instead.",
  selected_existing_generated: () => "Nothing changed — the existing generated artwork already matches these event facts and your comment.",
  skipped: (reason) => `Regeneration skipped: ${reason}`,
};

/**
 * Per-event AI artwork regeneration (spec item 9): a comment field plus a
 * "Regenerate image" button. Text layout on the rendered slide never moves
 * as a result of this — it's computed entirely from the event's own
 * fields, not the image — so this only ever changes the picture.
 */
export function RegenerateArtworkForm({ eventId, comment }: { eventId: string; comment: string }) {
  const [value, setValue] = useState(comment);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    setMessage(null);
    const formData = new FormData();
    formData.set("comment", value);
    startTransition(async () => {
      try {
        const result = await regenerateArtworkAction(eventId, formData);
        setMessage((ACTION_MESSAGE[result.action] ?? ((r: string) => r))(result.reason));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Regeneration failed — try again.");
      }
    });
  };

  return (
    <div style={{ padding: 16 }}>
      <label>Creative direction for the AI (optional)</label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="e.g. more blue lighting, no confetti, less crowded"
      />
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={pending}>
          {pending ? "Regenerating…" : "Regenerate image (AI)"}
        </button>
        {error && <div style={{ fontSize: 12, color: "var(--red, #e5484d)" }}>{error}</div>}
      </div>
      {message && !error && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", maxWidth: 480 }}>{message}</div>
      )}
      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
        Only the picture changes — the title, date, venue, price, and description are drawn separately and never
        move. If this event already has a real flyer from a source, that always wins over AI art. After
        regenerating, re-render any post using this event to see the new image.
      </p>
    </div>
  );
}
