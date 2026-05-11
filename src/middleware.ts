import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/server/auth.config";

// Edge-safe NextAuth instance. We intentionally do NOT import `@/server/auth`
// here — that file pulls in `@prisma/client` and `bcryptjs`, which would
// force the middleware onto the Node runtime and load the entire Prisma
// bundle on every request. Using the split config keeps middleware lean.
const { auth } = NextAuth(authConfig);

// Inline Role values as plain strings so we don't import the Prisma client
// enum (which drags Prisma into the edge bundle).
type Role =
  | "ADMIN"
  | "MANAGER"
  | "SALES"
  | "STORE_KEEPER"
  | "KITCHEN_HEAD"
  | "DELIVERY"
  | "ACCOUNTS";

// Path-pattern → allowed roles. First-match wins; rules higher in the list
// take precedence over rules lower down (used so /admin matches before any
// permissive default). ADMIN is implicitly allowed everywhere — we don't
// need to list it, the runtime adds it.
//
// Anything that isn't matched by any pattern is allowed for any
// authenticated user (since /forbidden, /dashboard etc. are role-neutral).
const ROLE_RULES: Array<{ pattern: RegExp; allow: Role[] }> = [
  // Admin
  { pattern: /^\/admin(\/|$)/, allow: ["ADMIN"] },

  // Queues — store and manager work surfaces
  { pattern: /^\/queue\/store-approvals(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER"] },
  { pattern: /^\/queue\/manager-approvals(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  { pattern: /^\/queue\/issuing(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER"] },

  // Sales modules
  { pattern: /^\/customers(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES", "ACCOUNTS"] },
  { pattern: /^\/quotes(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES"] },
  { pattern: /^\/dishes(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES", "KITCHEN_HEAD"] },

  // Orders — broad read access; per-action role checks are server-side
  { pattern: /^\/orders\/[^/]+\/requisition(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD"] },
  { pattern: /^\/orders(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES", "STORE_KEEPER", "KITCHEN_HEAD", "ACCOUNTS"] },

  // Operations
  { pattern: /^\/kitchen(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD", "SALES", "STORE_KEEPER", "ACCOUNTS"] },
  { pattern: /^\/requisitions(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD", "STORE_KEEPER", "SALES", "ACCOUNTS"] },
  { pattern: /^\/inventory(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER", "KITCHEN_HEAD"] },

  // Deliveries — DELIVERY role gets their own scope (enforced server-side
  // in listDeliveries / getDelivery); the route itself is allowed.
  { pattern: /^\/deliveries(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES", "ACCOUNTS", "KITCHEN_HEAD", "DELIVERY"] },

  // Mobile-shell routes (driver-focused; Phase 5). Reuses the same
  // data-scoping rules — listDeliveries/getDelivery already enforce
  // own-scope for DELIVERY role.
  { pattern: /^\/m(\/|$)/, allow: ["ADMIN", "MANAGER", "DELIVERY", "KITCHEN_HEAD", "STORE_KEEPER", "SALES", "ACCOUNTS"] },

  // Procurement — Phase 2 (placeholder accessible to relevant roles)
  { pattern: /^\/procurement(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER", "ACCOUNTS"] },

  // Finance
  { pattern: /^\/invoices(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS", "SALES"] },
  { pattern: /^\/payments(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/petty-cash(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/salary(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/reports(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
];

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // Public paths (no auth required)
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/mobile/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/q/") ||
    pathname.startsWith("/i/") ||
    pathname.startsWith("/api/pdf/public/") ||
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
  // ADMIN passes every gate.
  if (userRole === "ADMIN") return NextResponse.next();

  for (const rule of ROLE_RULES) {
    if (rule.pattern.test(pathname) && !rule.allow.includes(userRole)) {
      return NextResponse.redirect(new URL("/forbidden", nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|api/mobile|api/pdf/public|_next/static|_next/image|_next/data|favicon\\.ico|icons|manifest\\.webmanifest|q/|i/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|css|js|map|txt|woff2?|ttf|otf)$).*)",
  ],
};
