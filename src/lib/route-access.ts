/**
 * Which roles may open which route.
 *
 * Lives outside middleware.ts so it can be unit-tested: importing the
 * middleware pulls in NextAuth, which will not load outside the edge/next
 * runtime. Nothing here touches Prisma or bcrypt, so the middleware stays
 * on the edge bundle.
 */

// Inline Role values as plain strings so we don't import the Prisma client
// enum (which drags Prisma into the edge bundle).
export type Role =
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

// Path-pattern → allowed roles. FIRST MATCH WINS: the first rule whose
// pattern matches decides, and no later rule is consulted. Order
// specific-before-general — that is what lets a sub-path rule either
// restrict a broader one (/inventory/adjustments/new is management-only
// while the store keeper still reads the adjustments log) or widen it (the
// chef reaches /inventory/returns/declare though the /inventory/returns
// list is not theirs). Both directions work, only because the loop stops.
//
// It used to evaluate every matching rule and deny if any of them excluded
// the role, which silently made the narrower rule unable to widen anything.
// Four screens were dead: the chef's "Declare leftover return" and the
// declaration it opens, the manager's audit log, and the maintenance
// manager's room list — each allowed by its own rule, then denied by the
// catch-all underneath it.
//
// ADMIN is implicitly allowed everywhere — the runtime adds it.
//
// Anything that isn't matched by any pattern is allowed for any
// authenticated user (since /forbidden, /dashboard etc. are role-neutral).
const ROLE_RULES: Array<{ pattern: RegExp; allow: Role[] }> = [
  // Audit log — admin + manager may review it (must precede the /admin
  // catch-all below, which is admin-only). First match wins.
  { pattern: /^\/admin\/audit(\/|$)/, allow: ["ADMIN", "MANAGER"] },
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
  { pattern: /^\/customers(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES", "ACCOUNTS"] },
  { pattern: /^\/quotes(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES"] },
  { pattern: /^\/dishes(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES", "KITCHEN_HEAD"] },

  // Orders — kitchen sees the cooking brief, sales/F&B raise them. Accounts
  // works billing from /invoices (the Generate-invoice screen), not here.
  { pattern: /^\/orders\/[^/]+\/requisition(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD"] },
  // Mid-flight quantity revision (client changed pax) — commercial call, so
  // sales/manager/admin only; the reviseOrder action re-checks the role.
  { pattern: /^\/orders\/[^/]+\/revise(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES"] },
  { pattern: /^\/orders(\/|$)/, allow: ["ADMIN", "MANAGER", "SALES", "STORE_KEEPER", "KITCHEN_HEAD", "FNB_SERVICE", "DELIVERY", "ACCOUNTS"] },

  // Operations
  // Kitchen production board is the chef's (+ management oversight) only.
  { pattern: /^\/kitchen(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD"] },
  // Requisitions: chef raises, store fulfils.
  { pattern: /^\/requisitions(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD", "STORE_KEEPER"] },
  // Manpower — hired casual labour. Chef / F&B raise it, the manager approves
  // (or edits the figures first), accounts settle the real cost and pay. One
  // rule for the whole module: every screen is safe to reach for all of them,
  // and the actions enforce who may approve vs. who may move money.
  { pattern: /^\/manpower(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD", "FNB_SERVICE", "DELIVERY", "ACCOUNTS"] },
  // Setting a stock figure by hand — the single-item adjustment and the bulk
  // physical count — is admin/manager only (STOCK_EDIT_ROLES in
  // lib/stock-movement.ts; the actions enforce the same set). The store keeper
  // keeps the adjustments *log* below: it records what a manager corrected
  // under them, and that page says who to ask for a correction. These two
  // must precede the log rule, which precedes the /inventory catch-all.
  { pattern: /^\/inventory\/adjustments\/new(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  { pattern: /^\/inventory\/audit(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  { pattern: /^\/inventory\/adjustments(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER"] },
  // Issuing stock out is the store's job (not the chef, not accounts).
  { pattern: /^\/inventory\/issues(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER"] },
  // Stock coming back from the kitchen. The handover has two halves and they
  // gate separately, so these three must precede the /inventory/returns rule
  // below — which itself is unchanged.
  //   …/new     — the store's direct counter entry. Moves stock. Store only.
  //   …/declare — the chef saying what they're sending back. Moves nothing.
  //   …/<id>    — one document: the store's confirm screen, and the screen
  //               the chef opens to see whether their handover landed. The
  //               page renders controls only for the roles each action admits.
  { pattern: /^\/inventory\/returns\/new(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER"] },
  { pattern: /^\/inventory\/returns\/declare(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD"] },
  { pattern: /^\/inventory\/returns\/[^/]+$/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER", "KITCHEN_HEAD"] },
  // The returns list, and stock moving between the three stores — same hands
  // that issue it out.
  { pattern: /^\/inventory\/returns(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER"] },
  { pattern: /^\/inventory\/transfers(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER"] },
  // Adding stock by hand. NOT the store: goods reach the kitchen shelf by
  // receiving the delivery against its PO (the GRN), so the order, the goods
  // and the supplier's bill agree and the 3-way match has something to check.
  // A typed-in receipt bypasses all three. Accounts keep it for the
  // books-side receipt; the chef only ever reads stock levels.
  { pattern: /^\/inventory\/receipts(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  // Adding a NEW ingredient is management-only (store/chef were creating
  // duplicates that stranded GRNs). Must precede the /inventory rule below.
  { pattern: /^\/inventory\/ingredients\/new(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  // Inventory landing / ingredient list / stock levels — read for chef too.
  { pattern: /^\/inventory(\/|$)/, allow: ["ADMIN", "MANAGER", "STORE_KEEPER", "KITCHEN_HEAD", "ACCOUNTS"] },

  // Deliveries — DELIVERY role gets their own scope (enforced server-side
  // in listDeliveries / getDelivery); the route itself is allowed.
  { pattern: /^\/deliveries(\/|$)/, allow: ["ADMIN", "MANAGER", "KITCHEN_HEAD", "DELIVERY", "FNB_SERVICE"] },

  // Mobile-shell routes (driver-focused; Phase 5). Reuses the same
  // data-scoping rules — listDeliveries/getDelivery already enforce
  // own-scope for DELIVERY role.
  { pattern: /^\/m(\/|$)/, allow: ["ADMIN", "MANAGER", "DELIVERY", "KITCHEN_HEAD", "STORE_KEEPER", "SALES", "ACCOUNTS"] },

  // Procurement — the store keeper owns the buy cycle for kitchen shortfalls:
  // raise the PO, coordinate with the vendor, record the GRN. So they get
  // purchase orders, vendors and GRNs. Supplier bills + payment stay with
  // finance (admin / manager / accounts).
  { pattern: /^\/procurement\/vendor-bills(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS", "STORE_KEEPER"] },
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
  // alias). The team runs it end to end: receipts, issues, returns,
  // requisitions. Editing a stock figure by hand is not part of that — the
  // adjust screen and the bulk count are admin/manager, same as the kitchen
  // side. Specific before the /banquet rule below.
  { pattern: /^\/banquet\/adjust(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  { pattern: /^\/banquet\/stock-count(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  { pattern: /^\/banquet(\/|$)/, allow: ["ADMIN", "MANAGER", "FNB_SERVICE", "DELIVERY", "STORE_KEEPER"] },

  // Finance — invoices are accounts/management. The in-house (room service)
  // billing screen + viewing a generated bill are also open to F&B service
  // (they take and serve those orders); the invoice list, standalone +
  // from-order creation and editing stay finance-only.
  { pattern: /^\/invoices\/?$/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/invoices\/new(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/invoices\/generate(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/invoices\/[^/]+\/edit(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/invoices\/room-service(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS", "FNB_SERVICE", "DELIVERY"] },
  // SALES gets read access to invoice detail pages — they follow payment
  // status and the "invoice paid" notification links here. The list / new /
  // generate / edit rules above stay finance-only.
  { pattern: /^\/invoices(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS", "FNB_SERVICE", "DELIVERY", "SALES"] },
  { pattern: /^\/payments(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  // Petty cash is a finance-desk job — admin / manager / accounts. Salary +
  // reports stay admin/manager.
  { pattern: /^\/petty-cash(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
  { pattern: /^\/salary(\/|$)/, allow: ["ADMIN", "MANAGER"] },
  { pattern: /^\/reports(\/|$)/, allow: ["ADMIN", "MANAGER", "ACCOUNTS"] },
];

/**
 * The whole role decision, as a pure function so it can be tested without a
 * request. Exported for tests/unit/route-access.test.ts, which pins the
 * paths where first-match-wins is the difference between a working screen
 * and Access denied.
 */
export function routeAllows(pathname: string, role: Role): boolean {
  // ADMIN passes every gate.
  if (role === "ADMIN") return true;
  const rule = ROLE_RULES.find((r) => r.pattern.test(pathname));
  // Unmatched paths are role-neutral (/dashboard, /forbidden…).
  return rule ? rule.allow.includes(role) : true;
}

