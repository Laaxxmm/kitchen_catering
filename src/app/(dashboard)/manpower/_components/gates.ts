import { Role } from "@prisma/client";

/**
 * Mirrors the role sets in src/server/actions/manpower.ts. These decide only
 * what gets rendered — every action re-checks server-side — but keeping the
 * lists spelled out here is what stops a button appearing that will be
 * refused the moment it's clicked.
 */
export const RAISE_ROLES: Role[] = [
  Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD, Role.FNB_SERVICE, Role.DELIVERY,
];
export const APPROVE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER];
export const MONEY_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];
export const VIEW_ROLES: Role[] = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD,
  Role.ACCOUNTS, Role.DELIVERY, Role.FNB_SERVICE,
];

export function can(role: Role | undefined, allowed: Role[]): boolean {
  return role != null && allowed.includes(role);
}
