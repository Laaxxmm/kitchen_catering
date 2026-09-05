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
export async function GET(_req: NextRequest) {
  // A relative Location on purpose. Behind Railway's proxy the request URL
  // the handler sees is the container's own 0.0.0.0:8080, and building an
  // absolute URL from it sent browsers to a host that does not exist.
  // Browsers resolve a relative Location against the page they asked for.
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: "/login?reason=ended" },
  });
  // Auth.js names the cookie by scheme: `__Secure-` prefix over https.
  for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) {
    res.cookies.set(name, "", { maxAge: 0, path: "/" });
  }
  return res;
}
