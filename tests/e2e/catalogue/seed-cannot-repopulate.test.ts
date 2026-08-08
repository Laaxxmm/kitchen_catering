import "../harness/database-url";

import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ensureSeeded } from "../harness";

/**
 * The bootstrap seed must never re-plant its sample catalogue into a live
 * database.
 *
 * What happened: the client erased both catalogues and imported their own
 * 405 kitchen items. The next deploy booted the container, SEED_DB was still
 * "true" from the first-ever deploy, and prisma/seed.ts upserted all 136
 * demo STR-nnnn ingredients straight back in beside the real ones. Two
 * catalogues on one screen and nothing on it to explain the second.
 *
 * Every deploy is a boot, so this repeats until SEED_DB is unset — which is
 * exactly the kind of thing that gets forgotten. The seed now stops after
 * the users when it finds imported items, and this pins that.
 */

/** How the container boots it: tsx, with SEED_DB=true. */
function runSeed(): string {
  return execFileSync("npx", ["tsx", "prisma/seed.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, SEED_DB: "true" },
    stdio: "pipe",
    encoding: "utf8",
  });
}

beforeAll(async () => {
  // Leaves the database in the state go-live produces: erased, then imported.
  await ensureSeeded();
});

describe("seed against a live database", () => {
  it("plants no sample ingredients beside the imported catalogue", async () => {
    const before = await db.ingredient.count();
    runSeed();
    const [after, legacy] = await Promise.all([
      db.ingredient.count(),
      db.ingredient.count({ where: { NOT: { sku: { startsWith: "GP-" } } } }),
    ]);
    expect({ after, legacy }).toEqual({ after: before, legacy: 0 });
  });

  it("says why it stopped, so a boot log explains itself", () => {
    expect(runSeed()).toContain("skipping all sample data");
  });

  it("still keeps the desk logins up to date", async () => {
    runSeed();
    const admin = await db.user.findUnique({ where: { email: "admin@indefine.in" } });
    expect(admin?.active).toBe(true);
  });
});
