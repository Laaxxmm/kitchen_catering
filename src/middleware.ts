import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/server/auth.config";
import { routeAllows, type Role } from "@/lib/route-access";

// Edge-safe NextAuth instance. We intentionally do NOT import `@/server/auth`
// here — that file pulls in `@prisma/client` and `bcryptjs`, which would
// force the middleware onto the Node runtime and load the entire Prisma
// bundle on every request. Using the split config keeps middleware lean.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // Public paths (no auth required)
  if (
    pathname === "/login" ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/mobile/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico" ||
    // /q/<token> is the customer's quote link. It is the ONLY unauthenticated
    // app route; a prefix listed here for a path that does not exist yet is
    // an open door the day someone creates it, which is why /i/, /f/ and
    // /api/pdf/public/ came out.
    pathname.startsWith("/q/") ||
    pathname === "/forbidden"
  ) {
    return NextResponse.next();
  }

  const isAuthed = !!req.auth?.user;
  if (!isAuthed) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const userRole = req.auth!.user!.role as Role;
  if (!routeAllows(pathname, userRole)) {
    return NextResponse.redirect(new URL("/forbidden", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|api/mobile|_next/static|_next/image|_next/data|favicon\\.ico|icons|manifest\\.webmanifest|q/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|css|js|map|txt|woff2?|ttf|otf)$).*)",
  ],
};
