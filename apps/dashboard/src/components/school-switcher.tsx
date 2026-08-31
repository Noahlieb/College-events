"use client";

import { setCurrentSchoolAction } from "@/lib/actions";

/** Auto-submits on selection (no separate "Go" button) — this is a nav
 * control, not a form someone fills out field by field. */
export function SchoolSwitcher({ schools, current }: { schools: { shortName: string; name: string }[]; current: string }) {
  return (
    <form action={setCurrentSchoolAction} className="school-switcher">
      <select name="school" defaultValue={current} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {schools.map((s) => (
          <option key={s.shortName} value={s.shortName}>
            {s.name}
          </option>
        ))}
      </select>
    </form>
  );
}
