import "./pin-database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { createUser, deactivateUser, updateUser } from "@/server/actions/users";
import { listIngredients, setReorderLevel } from "@/server/actions/inventory";
import {
  asAdmin,
  asUser,
  ensureSeeded,
  expectRefused,
  mustOk,
  seeded,
  type HarnessUser,
} from "../harness";

/**
 * A signed-in browser used to outlive the account behind it.
 *
 * Web sessions are JWTs. Deactivating a user, or changing their role, wrote
 * the row and nothing else — the token stayed good for its full 30-day
 * lifetime, so a dismissed employee kept working from any browser that was
 * already open. requireSession now compares the version in the token with
 * the row on every guarded call. These are the cases that comparison exists
 * for; each one is a "before" that used to pass.
 */

async function throwaway(role: Role): Promise<HarnessUser> {
  await asAdmin();
  const email = `lifecycle.${role.toLowerCase()}.${Date.now()}@greenpath.test`;
  mustOk(
    await createUser({ email, name: "Lifecycle probe", password: "e2e-password", role }),
    "create probe user",
  );
  const row = await db.user.findUniqueOrThrow({ where: { email } });
  return { id: row.id, name: row.name, email: row.email, role: row.role, sessionVersion: row.sessionVersion };
}

/** Something the store keeper can do and nobody lower can. */
const storeCall = () => setReorderLevel(seeded().ingredients.plentiful, "5");

beforeAll(async () => {
  await ensureSeeded();
});

describe("a session behind a deactivated account", () => {
  it("ends on the next guarded call, not at token expiry", async () => {
    const probe = await throwaway(Role.STORE_KEEPER);
    asUser(probe);
    mustOk(await storeCall(), "works while active");

    await asAdmin();
    mustOk(await deactivateUser(probe.id), "admin deactivates");

    // Same token the browser still holds.
    asUser(probe);
    const why = await expectRefused(storeCall);
    expect(why).toMatch(/session has ended/i);
  });
});

describe("a session behind a role that changed", () => {
  it("loses the old role immediately", async () => {
    const probe = await throwaway(Role.STORE_KEEPER);
    asUser(probe);
    mustOk(await storeCall(), "store keeper can set a reorder level");

    await asAdmin();
    mustOk(await updateUser(probe.id, { role: Role.SALES }), "demote to sales");

    // The browser's token still says STORE_KEEPER; the row says otherwise
    // and its version moved, so the old token is out.
    asUser(probe);
    await expectRefused(storeCall);
  });

  it("gets the new role on a fresh sign-in, not the old one", async () => {
    const probe = await throwaway(Role.SALES);
    await asAdmin();
    mustOk(await updateUser(probe.id, { role: Role.STORE_KEEPER }), "promote to store");

    const fresh = await db.user.findUniqueOrThrow({ where: { id: probe.id } });
    asUser({ ...probe, role: fresh.role, sessionVersion: fresh.sessionVersion });
    mustOk(await storeCall(), "promoted user can do store work");
  });
});

describe("a token minted before versions existed", () => {
  it("is signed out once, then works after a real sign-in", async () => {
    const probe = await throwaway(Role.STORE_KEEPER);
    // The session callback maps a missing `sv` to -1.
    asUser({ ...probe, sessionVersion: -1 });
    await expectRefused(storeCall);
    asUser(probe);
    mustOk(await storeCall(), "current token works");
  });
});

describe("what did not change", () => {
  it("a password change ends other sessions too", async () => {
    const probe = await throwaway(Role.STORE_KEEPER);
    asUser(probe);
    mustOk(await storeCall(), "before");
    await asAdmin();
    mustOk(await updateUser(probe.id, { password: "a-new-password" }), "reset password");
    asUser(probe);
    await expectRefused(storeCall);
  });

  it("an ordinary profile edit does not log anyone out", async () => {
    const probe = await throwaway(Role.STORE_KEEPER);
    await asAdmin();
    mustOk(await updateUser(probe.id, { name: "Renamed probe" }), "rename");
    asUser(probe);
    mustOk(await storeCall(), "still signed in");
    expect((await listIngredients({ active: true })).length).toBeGreaterThan(0);
  });
});
