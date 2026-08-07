import { Role } from "@prisma/client";

/**
 * Who the next server action thinks it is.
 *
 * `requireRole` / `requireSession` in src/server/rbac.ts read `auth()` and
 * nothing else, so swapping the session is the whole of "log in as someone
 * different". setup.ts mocks `@/server/auth` to read this module; nothing
 * here may import the app, or the mock factory would load the real NextAuth.
 */

export interface HarnessUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** The six seeded desks, by the name the tests use. */
export type DeskName =
  | "admin"
  | "manager"
  | "chef"
  | "store"
  | "delivery"
  | "accounts";

export const DESK_ROLES: Record<DeskName, Role> = {
  admin: Role.ADMIN,
  manager: Role.MANAGER,
  chef: Role.KITCHEN_HEAD,
  store: Role.STORE_KEEPER,
  delivery: Role.DELIVERY,
  accounts: Role.ACCOUNTS,
};

export const DESK_EMAILS: Record<DeskName, string> = {
  admin: "e2e.admin@greenpath.test",
  manager: "e2e.manager@greenpath.test",
  chef: "e2e.chef@greenpath.test",
  store: "e2e.store@greenpath.test",
  delivery: "e2e.delivery@greenpath.test",
  accounts: "e2e.accounts@greenpath.test",
};

const desks = new Map<DeskName, HarnessUser>();
let current: HarnessUser | null = null;

/** Called by the seeder once the real User rows exist. */
export function registerDesk(desk: DeskName, user: HarnessUser): void {
  desks.set(desk, user);
}

export function desk(name: DeskName): HarnessUser {
  const user = desks.get(name);
  if (!user) {
    throw new Error(
      `No seeded user for "${name}" — call resetAndReseed() (or ensureSeeded()) first.`,
    );
  }
  return user;
}

/** What `auth()` returns. null = signed out. */
export function currentSession(): { user: HarnessUser } | null {
  return current ? { user: current } : null;
}

function become(name: DeskName): HarnessUser {
  current = desk(name);
  return current;
}

export const asAdmin = () => become("admin");
export const asManager = () => become("manager");
export const asChef = () => become("chef");
export const asStore = () => become("store");
export const asDelivery = () => become("delivery");
export const asAccounts = () => become("accounts");

/** Nobody is signed in — every guarded action must throw AuthenticationError. */
export function asNobody(): void {
  current = null;
}

/** Run one call as a desk and put the session back. Handy inside a scenario
 *  that is otherwise "the manager doing things". */
export async function actingAs<T>(name: DeskName, fn: () => Promise<T>): Promise<T> {
  const previous = current;
  current = desk(name);
  try {
    return await fn();
  } finally {
    current = previous;
  }
}
