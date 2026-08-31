import type { ReactNode } from "react";
import "./globals.css";
import { getCurrentSchool, listUniversities } from "@/lib/current-school";
import { SchoolSwitcher } from "@/components/SchoolSwitcher";

export const metadata = {
  title: "College Events — Admin",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every query on every page is scoped to whichever school this returns —
  // see the doc comment on SchoolSwitcher for why it has to be visible here,
  // in the nav, rather than tucked away on the Universities page alone.
  const [current, universities] = await Promise.all([getCurrentSchool(), listUniversities()]);

  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="brand">🦉 College Events Admin</span>
          <a href="/">Overview</a>
          <a href="/events">Events</a>
          <a href="/posts">Weekly Posts</a>
          <a href="/sources">Sources</a>
          <a href="/universities">Universities</a>
          <a href="/import">Import CSV</a>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Viewing</span>
            <SchoolSwitcher
              current={{ id: current.id, shortName: current.shortName }}
              universities={universities.map((u) => ({ id: u.id, shortName: u.shortName }))}
            />
          </span>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
