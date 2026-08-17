import { NextResponse, type NextRequest } from "next/server";

/**
 * Shared-password gate for the internal admin dashboard (spec §41). This is
 * an MVP control appropriate for a small internal team; swap for real auth
 * (Supabase Auth / SSO) before onboarding operators beyond the founding
 * team. Credentials never reach the client — this runs server-side only.
 */
export function middleware(request: NextRequest) {
  const expectedUser = process.env.ADMIN_USERNAME ?? "admin";
  const expectedPass = process.env.ADMIN_PASSWORD;

  if (!expectedPass) {
    // No password configured — fail closed rather than silently open.
    return new NextResponse("Dashboard auth is not configured. Set ADMIN_PASSWORD.", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice(6));
    const separatorIndex = decoded.indexOf(":");
    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);
    if (user === expectedUser && pass === expectedPass) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="College Events Dashboard"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
