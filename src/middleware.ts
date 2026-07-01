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
  | "ACCOUNTS"
  | "HOUSEKEEPING_MANAGER"
  | "MAINTENANCE_MANAGER"
  | "FNB_SERVICE";

// Path-pattern → allowed roles. A request must be allowed by EVERY rule it
// matches (the loop below redirects on the first matching rule that denies).
// This lets a specific sub-path rule *further restrict* a broader one — e.g.
// /procurement allows the store keeper, but the /procurement/vendor-bills
// rule above it does not, so the store keeper is blocked from bills while
// still reaching /procurement/purchase-orders. Order specific-before-general.
// ADMIN is implicitly allowed everywhere — the runtime adds it.
//
// Anything that isn't matched by any pattern is allowed for any
// authenticated user (since /forbidden, /dashboard etc. are role-neutral).
const ROLE_RULES: Array<{ pattern: RegExp; allow: Role[] }> = [
  // Admin
  { pattern: /^\/admin(\/|$)/, allow: ["ADMIN"] },

  // Queues — admin-approvals (PENDING_ADMIN_APPROVAL) is the v3 first
  // stop; chef-approvals (PENDING_CHEF_APPROVAL) is the next hand-off;
  // manager-approvals handles chef-proposed changes; issuing is store-side.
  // First order gate — now the manager's call (admin may also act).
  { pattern: /^\/queue\/admin-approvals(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  { pattern: /^\/queue\/chef-approvals(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD"] },
  { pattern: /^\/queue\/manager-approvals(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  { pattern: /^\/queue\/issuing(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER"] },

  // Tasks — admin board is admin/manager only; the per-user task list
  // and detail pages are open to any authenticated user (server actions
  // enforce per-task visibility).
  { pattern: /^\/tasks\/admin(\/|$)/, allow: ["ADMIN", "MANAGER"] },

  // Sales modules
  { pattern: /^\/customers(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES"] },
  { pattern: /^\/quotes(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES"] },
  { pattern: /^\/dishes(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES", "KITCHEN_HEAD"] },

  // Orders — kitchen sees the cooking brief, sales/F&B raise them. Accounts
  // works billing from /invoices (the Generate-invoice screen), not here.
  { pattern: /^\/orders\/[^/]+\/requisition(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD"] },
  { pattern: /^\/orders(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES", "STORE_KEEPER", "KITCHEN_HEAD", "FNB_SERVICE", "DELIVERY"] },

  // Operations
  // Kitchen production board is the chef's (+ management oversight) only.
  { pattern: /^\/kitchen(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD"] },
  // Requisitions: chef raises, store fulfils.
  { pattern: /^\/requisitions(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD", "STORE_KEEPER"] },
  // Manual stock adjustments are admin/manager only (write-offs, opening fixes).
  { pattern: /^\/inventory\/adjustments(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  // Issuing stock out is the store's job (not the chef, not accounts).
  { pattern: /^\/inventory\/issues(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER"] },
  // Recording incoming stock — store + accounts (books-side receipt). The
  // chef can view stock levels but doesn't record receipts.
  { pattern: /^\/inventory\/receipts(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER", "ACCOUNTS"] },
  // Inventory landing / ingredient list / stock levels — read for chef too.
  { pattern: /^\/inventory(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER", "KITCHEN_HEAD", "ACCOUNTS"] },

  // Deliveries — DELIVERY role gets their own scope (enforced server-side
  // in listDeliveries / getDelivery); the route itself is allowed.
  { pattern: /^\/deliveries(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD", "DELIVERY"] },

  // Mobile-shell routes (driver-focused; Phase 5). Reuses the same
  // data-scoping rules — listDeliveries/getDelivery already enforce
  // own-scope for DELIVERY role.
  { pattern: /^\/m(\/|$)/, allow: ["ADMIN", "MANAGER", "DELIVERY", "KITCHEN_HEAD", "STORE_KEEPER", "SALES", "ACCOUNTS"] },

  // Procurement — the store keeper owns the buy cycle for kitchen shortfalls:
  // raise the PO, coordinate with the vendor, record the GRN. So they get
  // purchase orders, vendors and GRNs. Supplier bills + payment stay with
  // finance (admin / manager / accounts).
  { pattern: /^\/procurement\/vendor-bills(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/procurement(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER", "ACCOUNTS"] },

  // Housekeeping — hotel-side stockroom. Open to admin / manager (oversight)
  // and the dedicated housekeeping manager who actually drives the module.
  // Maintenance manager also gets read access to /housekeeping/rooms (rooms
  // are a shared master) — server actions enforce write boundaries.
  { pattern: /^\/housekeeping\/rooms(\/|$)/, allow: ["ADMIN", "MANAGER", "HOUSEKEEPING_MANAGER", "MAINTENANCE_MANAGER"] },
  { pattern: /^\/housekeeping(\/|$)/, allow: ["ADMIN", "MANAGER", "HOUSEKEEPING_MANAGER"] },

  // Maintenance — electrical/mechanical work + spares inventory.
  { pattern: /^\/maintenance(\/|$)/, allow: ["ADMIN", "MANAGER", "MAINTENANCE_MANAGER"] },

  // Banquet — the F&B Service store (role DELIVERY, FNB_SERVICE its retired
  // alias). The whole team runs it end to end: catalogue, receipts, issues,
  // adjustments.
  { pattern: /^\/banquet(\/|$)/, allow: ["ADMIN", "MANAGER", "FNB_SERVICE", "DELIVERY"] },

  // Finance — invoices are accounts/management. The in-house (room service)
  // billing screen + viewing a generated bill are also open to F&B service
  // (they take and serve those orders); the invoice list, standalone +
  // from-order creation and editing stay finance-only.
  { pattern: /^\/invoices\/?$/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/invoices\/new(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/invoices\/generate(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/invoices\/[^/]+\/edit(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/invoices\/room-service(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS", "FNB_SERVICE", "DELIVERY"] },
  { pattern: /^\/invoices(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS", "FNB_SERVICE", "DELIVERY"] },
  { pattern: /^\/payments(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  // Petty cash is a finance-desk job — admin / manager / accounts. Salary +
  // reports stay admin/manager.
  { pattern: /^\/petty-cash(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/salary(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  { pattern: /^\/reports(\/|$)/, allow: ["ADMIN", "MANAGER"] },
];

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
    pathname.startsWith("/q/") ||
    pathname.startsWith("/i/") ||
    pathname.startsWith("/f/") ||
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
