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
    "procurement", "invoices", "payments", "pettycash", "salary", "reports",
    "housekeeping", "maintenance", "banquet", "admin",
  ]),
  MANAGER: new Set([
    "dashboard", "tasks", "customers", "quotes", "orders", "dishes",
    "kitchen", "requisitions", "deliveries", "inventory",
    "procurement", "invoices", "payments", "pettycash", "salary", "reports",
    "housekeeping", "maintenance", "banquet",
  ]),
  SALES: new Set([
    "dashboard", "tasks", "customers", "quotes", "orders", "dishes",
  ]),
  // Storekeeper: just stock + requisitions + receiving supplies.
  // Orders/dishes/quotes aren't part of their daily work — kept out so
  // the sidebar doesn't overwhelm.
  STORE_KEEPER: new Set([
    "dashboard", "tasks", "requisitions", "inventory", "procurement",
  ]),
  // Kitchen head: cooking-side work. They don't need to see customers
  // or inventory minutiae; chef requisitions surface stock context.
  KITCHEN_HEAD: new Set([
    "dashboard", "tasks", "orders", "kitchen", "requisitions", "dishes",
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
    "dashboard", "tasks", "invoices", "payments", "procurement", "inventory",
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
  // F&B service: takes room-service / alacarte / management orders and
  // drives the banquet store (Phase 3). Order-channel UI lands in
  // Phase 4.
  FNB_SERVICE: new Set([
    "dashboard", "tasks", "banquet",
  ]),
};

export function canSeeSidebarKey(role: Role | undefined, key: string): boolean {
  if (!role) return false;
  return SIDEBAR_KEYS_BY_ROLE[role]?.has(key) ?? false;
}
