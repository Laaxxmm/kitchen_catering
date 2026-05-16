import { NextResponse, type NextRequest } from "next/server";

/**
 * Defensive route handler for /api/auth/error.
 *
 * NextAuth.js v5 has a known issue where its catch-all
 * `[...nextauth]/route.ts` cannot parse the path segment `error` as a
 * valid action, so any request that lands at `/api/auth/error`
 * (typically after a session-verification failure, a JWT signature
 * mismatch from a rotated AUTH_SECRET, or a stale cookie from a
 * previous deploy) throws:
 *
 *   `UnknownAction: Cannot parse action at /api/auth/error`
 *
 * …and the browser sees a generic 400 "Bad Request".
 *
 * `pages.error = "/login"` in `auth.config.ts` redirects most internal
 * NextAuth flows back to /login already, but this concrete handler
 * intercepts any direct hits before they reach the catch-all, so the
 * worst case is still a friendly login page (with the error code in
 * the URL) rather than a cryptic 400.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bounce(req: NextRequest) {
  const url = new URL("/login", req.url);
  const err = req.nextUrl.searchParams.get("error");
  if (err) url.searchParams.set("error", err);
  return NextResponse.redirect(url, { status: 302 });
}

export const GET = bounce;
export const POST = bounce;
