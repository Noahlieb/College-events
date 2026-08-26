"use client";

import { useTransition, useState } from "react";
import { EVENT_CATEGORIES, type EventCategory } from "@college-events/core";
import { updateEventAction } from "@/lib/actions";

/**
 * Next's own `isRedirectError` isn't part of `next/navigation`'s public
 * export surface in this Next.js version — see ImportCsvForm.tsx for the
 * same note. A redirect() error's documented contract is a `digest` string
 * starting with "NEXT_REDIRECT", so this checks that directly instead of
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
 * Same silent-failure shape as every other plain `<form action={...}>` this
 * app used to have: click Save, nothing visibly happens until the page
 * quietly revalidates (or doesn't, if the request is still in flight) — no
 * pending state, no error surfaced if the write fails. Wrapping it exactly
 * like ImportCsvForm/ImportCsvForm's siblings gives it the same visible
 * "Saving…" state and an error message instead of a dead click.
 */
export function EditEventForm({
  eventId,
  postId,
  name,
  venue,
  price,
  category,
  description,
}: {
  eventId: string;
  postId?: string;
  name: string;
  venue: string;
  price: string;
  category: EventCategory;
  description: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await updateEventAction(eventId, formData);
        setSaved(true); // only reached when there's no postId — otherwise the action redirects
      } catch (err) {
        if (isRedirectError(err)) throw err; // the successful-save path — let it navigate
        setError(err instanceof Error ? err.message : "Save failed — try again.");
      }
    });
  };

  return (
    <form onSubmit={onSubmit} style={{ padding: 16 }}>
      <label>Name</label>
      {postId ? <input type="hidden" name="postId" value={postId} /> : null}
      <input name="name" defaultValue={name} />
      <label>Venue</label>
      <input name="venue" defaultValue={venue} />
      <label>Price</label>
      <input name="price" defaultValue={price} />
      <label>Category</label>
      <select name="category" defaultValue={category}>
        {EVENT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <label>Description</label>
      <textarea name="description" rows={4} defaultValue={description} />
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        {error && <div style={{ fontSize: 12, color: "var(--red, #e5484d)" }}>{error}</div>}
        {saved && !error && <div style={{ fontSize: 12, color: "var(--muted)" }}>Saved.</div>}
      </div>
    </form>
  );
}
