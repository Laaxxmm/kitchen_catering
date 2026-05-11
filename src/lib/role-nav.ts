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
    "dashboard", "customers", "quotes", "orders", "dishes",
    "kitchen", "requisitions", "deliveries", "inventory",
    "procurement", "invoices", "payments", "pettycash", "salary", "reports", "admin",
  ]),
  MANAGER: new Set([
    "dashboard", "customers", "quotes", "orders", "dishes",
    "kitchen", "requisitions", "deliveries", "inventory",
    "procurement", "invoices", "payments", "pettycash", "salary", "reports",
  ]),
  SALES: new Set([
    "dashboard", "customers", "quotes", "orders", "dishes",
  ]),
  STORE_KEEPER: new Set([
    "dashboard", "orders", "requisitions", "inventory", "procurement",
  ]),
  KITCHEN_HEAD: new Set([
    "dashboard", "orders", "kitchen", "requisitions", "dishes",
  ]),
  DELIVERY: new Set([
    "dashboard", "deliveries",
  ]),
  ACCOUNTS: new Set([
    "dashboard", "customers", "orders", "invoices", "payments", "pettycash", "salary", "reports",
  ]),
};

export function canSeeSidebarKey(role: Role | undefined, key: string): boolean {
  if (!role) return false;
  return SIDEBAR_KEYS_BY_ROLE[role]?.has(key) ?? false;
}
