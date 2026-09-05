import { cache } from "react";
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "./db";

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

/**
 * The User row as it is NOW, not as it was when the token was minted. One
 * primary-key read per request — `cache` dedupes it across every guarded
 * call in the same render, so a page that touches six actions pays once.
 */
const liveUser = cache((id: string) =>
  db.user.findUnique({
    where: { id },
    select: { active: true, role: true, sessionVersion: true },
  }),
);

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) throw new AuthenticationError();

  // The JWT used to be trusted for its whole lifetime, so deactivating
  // someone — or changing their role — did nothing to a browser that was
  // already signed in. Compare the token's version with the row: a
  // mismatch (deactivate, role change, password change) ends the session
  // on this call, and the role is taken from the row so a change applies
  // now rather than at the next login.
  const live = await liveUser(session.user.id);
  if (!live || !live.active || live.sessionVersion !== session.user.sessionVersion) {
    throw new AuthenticationError("Your session has ended — please sign in again");
  }
  session.user.role = live.role;
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
// Order entry roles. SALES handles corporate catering; the F&B Service role
// (internally DELIVERY, with FNB_SERVICE its retired alias) handles room
// service / alacarte / management orders. Server actions still discriminate
// on channel for fine-grained gates.
export const ORDER_SALES_ROLES = [Role.ADMIN, Role.MANAGER, Role.SALES, Role.FNB_SERVICE, Role.DELIVERY];
export const ORDER_STORE_ROLES = [Role.ADMIN, Role.STORE_KEEPER];
export const ORDER_MANAGER_ROLES = [Role.ADMIN, Role.MANAGER];
export const ORDER_KITCHEN_ROLES = [Role.ADMIN, Role.KITCHEN_HEAD];

/** Chef requisition: chef raises; storekeeper fulfils. */
export const REQUISITION_CREATE_ROLES = [Role.ADMIN, Role.KITCHEN_HEAD];
export const REQUISITION_FULFIL_ROLES = [Role.ADMIN, Role.STORE_KEEPER];
