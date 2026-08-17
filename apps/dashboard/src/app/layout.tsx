import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "College Events — Admin",
};

export default function RootLayout({ children }: { children: ReactNode }) {
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
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
