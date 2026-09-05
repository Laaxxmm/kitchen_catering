import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/ended — clear a session cookie the server no longer honours
 * and land on /login.
 *
 * requireSession rejects a token whose sessionVersion no longer matches the
 * User row (deactivated, role changed, or minted before versions existed).
 * The cookie itself is still a valid JWT, so the middleware lets it through
 * and /login bounces "signed-in" users back — without this the person is
 * trapped between an error page and a login page that won't show. A route
 * handler can clear cookies; a server component cannot.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login?reason=ended", req.url), { status: 303 });
  // Auth.js names the cookie by scheme: `__Secure-` prefix over https.
  for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) {
    res.cookies.set(name, "", { maxAge: 0, path: "/" });
  }
  return res;
}
