import { Role } from "@prisma/client";
import { auth } from "./auth";

export class AuthorizationError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) throw new AuthenticationError();
  return session;
}

export async function requireRole(roles: Role[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    throw new AuthorizationError(`Requires one of: ${roles.join(", ")}`);
  }
  return session;
}

export function hasRole(session: { user: { role: Role } }, roles: Role[]) {
  return roles.includes(session.user.role);
}

// ─── Module-specific guards ──────────────────────────────────────────────

/** Order approval guards. State + role checks happen inside the action's
 *  transaction; these helpers cover the role-only common case. */
export const ORDER_SALES_ROLES = [Role.ADMIN, Role.MANAGER, Role.SALES];
export const ORDER_STORE_ROLES = [Role.ADMIN, Role.STORE_KEEPER];
export const ORDER_MANAGER_ROLES = [Role.ADMIN, Role.MANAGER];
export const ORDER_KITCHEN_ROLES = [Role.ADMIN, Role.KITCHEN_HEAD];

/** Chef requisition: chef raises; storekeeper fulfils. */
export const REQUISITION_CREATE_ROLES = [Role.ADMIN, Role.KITCHEN_HEAD];
export const REQUISITION_FULFIL_ROLES = [Role.ADMIN, Role.STORE_KEEPER];
