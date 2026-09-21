import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// NOTE: has_session is a plain (non-httpOnly) marker cookie set by the
// client after a successful login — it is NOT the real auth token (that
// lives in httpOnly cookies set by the backend). This check only prevents
// an obviously logged-out visitor from momentarily seeing the dashboard
// shell before a redirect; it proves nothing about token validity. The
// actual authority is the backend's /me call made in dashboard/page.tsx.
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.get("has_session")?.value === "true";

  if (!hasSession) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};