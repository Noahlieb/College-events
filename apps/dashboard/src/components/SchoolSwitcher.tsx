"use client";

import { useRef, useTransition } from "react";
import { selectUniversityAction } from "@/lib/discovery-actions";

/**
 * Which university every page's data belongs to — every query in this app
 * is scoped to whatever getCurrentSchool() returns, but until now nothing
 * on screen said what that was outside the Universities page itself. That
 * silence is exactly how CSV imports for other schools ended up filed
 * under FAU: nothing on the Import page showed which school new events
 * would land in, so an operator uploading a Miami file while the cookie
 * still pointed at FAU (the hardcoded fallback — see current-school.ts)
 * had no on-screen signal anything was wrong. This switcher is always
 * visible in the nav specifically to close that gap, not just on Import.
 */
export function SchoolSwitcher({
  current,
  universities,
}: {
  current: { id: string; shortName: string };
  universities: { id: string; shortName: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const formData = new FormData();
    formData.set("schoolId", e.target.value);
    startTransition(async () => {
      await selectUniversityAction(formData);
    });
  };

  return (
    <form ref={formRef} className="school-switcher">
      <select
        aria-label="Current university"
        value={current.id}
        onChange={onChange}
        disabled={pending}
        style={{ fontSize: 12, width: "auto", padding: "5px 8px" }}
      >
        {universities.map((u) => (
          <option key={u.id} value={u.id}>
            {u.shortName}
          </option>
        ))}
      </select>
    </form>
  );
}
