import type { Role } from "@prisma/client";

/**
 * UI labels for the Role enum. Single source of truth — every sidebar,
 * dropdown, badge, and audit log line that renders a role should read
 * from here, NEVER print the raw enum.
 *
 * The internal enum names (KITCHEN_HEAD, STORE_KEEPER, …) stay stable
 * so we don't churn the database or break existing migrations / audit
 * logs. The DISPLAYED labels follow the client's vocabulary from
 * the Workflow doc:
 *
 *   Admin / Manager / Sales / Production / Store / HK / Engineer /
 *   F&B / Delivery / Accounts
 */
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  SALES: "Sales",
  KITCHEN_HEAD: "Production",
  STORE_KEEPER: "Store",
  HOUSEKEEPING_MANAGER: "HK",
  MAINTENANCE_MANAGER: "Engineer",
  // DELIVERY is the merged F&B Service role — deliveries + room service +
  // banquet. FNB_SERVICE is the retired predecessor (users migrated to
  // DELIVERY); it keeps a label only so any stray historical row still reads
  // cleanly.
  FNB_SERVICE: "F&B Service",
  DELIVERY: "F&B Service",
  ACCOUNTS: "Accounts",
};

/** Safe lookup that falls back to a humanised enum if Prisma adds a
 *  role we haven't labelled yet — avoids printing `KITCHEN_HEAD` raw. */
export function roleLabel(role: Role | string | null | undefined): string {
  if (!role) return "—";
  if (role in ROLE_LABEL) return ROLE_LABEL[role as Role];
  return String(role)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
