import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
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

/**
 * Page-level role gate. Use at the top of server components.
 * On AuthenticationError -> redirect to /login.
 * On AuthorizationError  -> redirect to /forbidden.
 *
 * Unlike `requireRole`, this function never throws back into the page;
 * it always either returns a session or redirects.
 */
export async function gateRolePage(roles: Role[]) {
  try {
    return await requireRole(roles);
  } catch (e) {
    if (e instanceof AuthenticationError) redirect("/login");
    if (e instanceof AuthorizationError) redirect("/forbidden");
    throw e;
  }
}

// ─── Module-specific guards ──────────────────────────────────────────────

/** Order approval guards. State + role checks happen inside the action's
 *  transaction; these helpers cover the role-only common case. */
// Order entry roles. SALES handles corporate catering; FNB_SERVICE
// (added Phase 4) handles room service / alacarte / management orders.
// Server actions still discriminate on channel for fine-grained gates.
export const ORDER_SALES_ROLES = [Role.ADMIN, Role.MANAGER, Role.SALES, Role.FNB_SERVICE];
export const ORDER_STORE_ROLES = [Role.ADMIN, Role.STORE_KEEPER];
export const ORDER_MANAGER_ROLES = [Role.ADMIN, Role.MANAGER];
export const ORDER_KITCHEN_ROLES = [Role.ADMIN, Role.KITCHEN_HEAD];

/** Chef requisition: chef raises; storekeeper fulfils. */
export const REQUISITION_CREATE_ROLES = [Role.ADMIN, Role.KITCHEN_HEAD];
export const REQUISITION_FULFIL_ROLES = [Role.ADMIN, Role.STORE_KEEPER];
