"use client";

import type { EventCategory } from "@college-events/core";

/** Auto-submits on selection, same pattern as SchoolSwitcher — this is a
 * quick row-level edit, not a form someone reviews before submitting. */
export function InlineCategorySelect({
  category,
  categories,
  action,
}: {
  category: EventCategory;
  categories: readonly EventCategory[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action}>
      <select name="category" defaultValue={category} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </form>
  );
}
