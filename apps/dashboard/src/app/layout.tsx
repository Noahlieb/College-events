import type { ReactNode } from "react";
import { asc } from "drizzle-orm";
import { db, schools } from "@college-events/db";
import { SchoolSwitcher } from "@/components/school-switcher";
import { getCurrentSchool } from "@/lib/current-school";
import "./globals.css";

export const metadata = {
  title: "College Events — Admin",
};

// Matches every page under it: the layout now queries the DB and reads a
// cookie to build the school switcher, so it must never be statically
// prerendered (that would otherwise trip up Next's build-time evaluation
// of implicit static routes like /_not-found, which don't have their own
// dynamic opt-out).
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const allSchools = await db
    .select({ shortName: schools.shortName, name: schools.name })
    .from(schools)
    .orderBy(asc(schools.name));
  const current = await getCurrentSchool();

  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="brand">🦉 College Events Admin</span>
          <a href="/">Overview</a>
          <a href="/events">Events</a>
          <a href="/posts">Weekly Posts</a>
          <a href="/sources">Sources</a>
          <a href="/import">Import CSV</a>
          {allSchools.length > 1 && <SchoolSwitcher schools={allSchools} current={current.shortName} />}
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
