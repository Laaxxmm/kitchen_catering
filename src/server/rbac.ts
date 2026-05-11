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

// Module-specific guards (canApproveOrder, canCreateChefRequisition,
// canFulfilChefRequisition, canIssueInvoice, etc.) arrive in Phase 1.
