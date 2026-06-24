import type { Role } from "@prisma/client";

/**
 * Per-role allowlist of sidebar nav keys. The Sidebar filters its NAV
 * array against this set so each user only sees modules they can actually
 * use. This is UI-only gating; server-side `requireRole`/`gateRolePage`
 * enforces the real permission boundary.
 *
 * Read this together with src/server/rbac.ts and CLAUDE.md role rules.
 */
export const SIDEBAR_KEYS_BY_ROLE: Record<Role, ReadonlySet<string>> = {
  ADMIN: new Set([
    "dashboard", "tasks", "customers", "quotes", "orders", "dishes",
    "kitchen", "requisitions", "deliveries", "inventory",
    "requests", "purchaseorders", "vendors", "supplierbills",
    "invoices", "payments", "pettycash", "salary", "reports",
    "housekeeping", "maintenance", "banquet", "admin",
  ]),
  MANAGER: new Set([
    "dashboard", "tasks", "customers", "quotes", "orders", "dishes",
    "kitchen", "requisitions", "deliveries", "inventory",
    "requests", "purchaseorders", "vendors", "supplierbills",
    "invoices", "payments", "pettycash", "salary", "reports",
    "housekeeping", "maintenance", "banquet",
  ]),
  SALES: new Set([
    "dashboard", "tasks", "customers", "quotes", "orders", "dishes",
  ]),
  // Storekeeper: stock + requisitions + raising shortage requests. They do
  // NOT see vendors, purchase orders or supplier bills — picking suppliers,
  // pricing and paying are the manager's / admin's / accounts' job. The
  // store just says "we're short on X" (a request) and issues/receives stock.
  STORE_KEEPER: new Set([
    "dashboard", "tasks", "requisitions", "inventory", "requests",
  ]),
  // Kitchen head: cooking-side work only. No Sales section — they drive
  // everything from the tabbed kitchen dashboard + Kitchen + Requisitions.
  // (Order detail pages are still reachable via the dashboard "Open" links;
  // route access is enforced in middleware, not this nav allowlist.)
  KITCHEN_HEAD: new Set([
    "dashboard", "tasks", "kitchen", "requisitions",
  ]),
  DELIVERY: new Set([
    "dashboard", "tasks", "deliveries",
  ]),
  // Accounts: strictly the books-side workspace. They see invoices,
  // pay vendors, record incoming stock, and run dashboards. They do NOT
  // manage customers / orders / dishes — that's sales / admin territory.
  // Mark-as-paid for customer invoices is also gated to admin/manager
  // (see customer-invoices.markCustomerInvoicePaid).
  ACCOUNTS: new Set([
    "dashboard", "tasks", "invoices", "payments", "inventory",
    "purchaseorders", "vendors", "supplierbills",
  ]),
  // Housekeeping manager: laser-focused on the hotel-side stockroom.
  // Personal task list + housekeeping module only.
  HOUSEKEEPING_MANAGER: new Set([
    "dashboard", "tasks", "housekeeping",
  ]),
  // Maintenance manager: electrical + mechanical work-log and spares store.
  MAINTENANCE_MANAGER: new Set([
    "dashboard", "tasks", "maintenance",
  ]),
  // F&B service: takes room-service / alacarte / management orders
  // (Phase 4) and drives the banquet store (Phase 3).
  FNB_SERVICE: new Set([
    "dashboard", "tasks", "orders", "banquet",
  ]),
};

export function canSeeSidebarKey(role: Role | undefined, key: string): boolean {
  if (!role) return false;
  return SIDEBAR_KEYS_BY_ROLE[role]?.has(key) ?? false;
}
