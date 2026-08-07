import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import {
  resetEverythingKeepParties,
  resetTransactionalData,
} from "@/server/actions/admin-reset";
import { createUser } from "@/server/actions/users";
import { createCustomer } from "@/server/actions/customers";
import { createVendor } from "@/server/actions/vendors";
import { createDish } from "@/server/actions/dishes";
import {
  DESK_EMAILS,
  DESK_ROLES,
  asAdmin,
  registerDesk,
  type DeskName,
} from "./session";
import { mustOk } from "./assert";

/**
 * Go-live in miniature: wipe to a clean slate, load the real catalogue, then
 * put the six desks, one customer, one supplier and two dishes back.
 *
 * The order is the thing under test. On a fresh database the data-migrations
 * leave ~362 legacy ingredients and 85 legacy F&B items behind, and
 * catalogue:import refuses (correctly) rather than half-merge onto them.
 * Reset first, import second — if that sequence breaks, production cannot go
 * live, so it runs for real here rather than being simulated.
 */

/** Ingredients the scenarios use, by their catalogue code. */
export const INGREDIENT_CODES = {
  /** 25 kg opening stock — the line the store can issue in full. */
  plentiful: "GP-018", // Maida
  /** No opening stock — the line that goes short and needs a purchase. */
  scarce: "GP-001", // Paneer
} as const;

export interface Fixtures {
  customerId: string;
  vendorId: string;
  dishIds: string[];
  ingredients: { plentiful: string; scarce: string };
}

let fixtures: Fixtures | null = null;
let seeding: Promise<Fixtures> | null = null;

/** The seeded master data. Throws if resetAndReseed() hasn't run. */
export function seeded(): Fixtures {
  if (!fixtures) throw new Error("Call ensureSeeded() first.");
  return fixtures;
}

/**
 * Reset + import + master data. Idempotent per process: the catalogue import
 * is ~600 round trips, so the first caller pays for it and everyone else
 * waits on the same promise.
 */
export function ensureSeeded(): Promise<Fixtures> {
  seeding ??= resetAndReseed();
  return seeding;
}

export async function resetAndReseed(): Promise<Fixtures> {
  await ensureDesks();
  asAdmin();

  // 1. Clean slate — the real ADMIN-gated action with its confirmation phrase.
  const reset = mustOk(
    await resetEverythingKeepParties("ERASE EVERYTHING"),
    "full reset",
  );
  if (reset.kitchenItems > 0 || reset.fnbItems > 0) {
    // Nothing to assert yet, but leave a trace of what was cleared: a reset
    // that silently cleared nothing is the failure mode worth seeing.
    console.info(
      `[e2e] reset cleared ${reset.kitchenItems} kitchen + ${reset.fnbItems} F&B items across ${reset.tablesCleared} tables`,
    );
  }

  // The reset deliberately KEEPS customers, suppliers and the menu. For a
  // repeatable harness they have to go too, or every run stacks another
  // "E2E Caterers" on top of the last one.
  await clearKeptMasterData();

  // 2. The client's real catalogue: 405 kitchen, 154 F&B in-house, 42 hired.
  importCatalogue();

  // 3. Master data the scenarios trade in, through the real actions.
  const customer = mustOk(
    await createCustomer({
      name: "E2E Catering Client",
      billingAddress: "12 Test Road, Bengaluru",
      stateCode: "29",
      contactName: "Test Contact",
      // A real address: the invoice-email gate must refuse because the
      // invoice is unapproved, not because there's nobody to send it to.
      email: "client@e2e.test",
      phone: "9000000001",
    }),
    "create customer",
  );

  const vendor = mustOk(
    await createVendor({
      name: "E2E Provisions",
      stateCode: "29",
      contactName: "Supplier Contact",
      phone: "9000000002",
      email: "supplier@e2e.test",
    }),
    "create vendor",
  );

  const dishIds: string[] = [];
  for (const [name, price] of [
    ["E2E Paneer Butter Masala", "260.00"],
    ["E2E Veg Pulao", "180.00"],
  ] as const) {
    const dish = mustOk(
      await createDish({ name, unitPrice: price, unit: "portion", gstRatePct: "5" }),
      `create dish ${name}`,
    );
    dishIds.push(dish.id);
  }

  const [plentiful, scarce] = await Promise.all([
    findIngredient(INGREDIENT_CODES.plentiful),
    findIngredient(INGREDIENT_CODES.scarce),
  ]);

  fixtures = {
    customerId: customer.id,
    vendorId: vendor.id,
    dishIds,
    ingredients: { plentiful, scarce },
  };
  return fixtures;
}

/**
 * Wipe the transactional tables between test files without re-importing the
 * catalogue. The real ADMIN action, so it is itself exercised — it also
 * rewinds ingredient stock to opening, which is what makes each file's
 * "receive N kg, issue M" arithmetic start from a known place.
 */
export async function freshSlate(): Promise<void> {
  asAdmin();
  mustOk(await resetTransactionalData("RESET"), "transactional reset");
}

// ─── internals ──────────────────────────────────────────────────────────

async function findIngredient(sku: string): Promise<string> {
  const row = await db.ingredient.findUnique({ where: { sku }, select: { id: true } });
  if (!row) {
    throw new Error(`Catalogue import left no ingredient ${sku} — did the import run?`);
  }
  return row.id;
}

/**
 * The six desks. The first admin has to be written directly — createUser is
 * ADMIN-gated, and on an empty database there is no admin to be. Everyone
 * else goes through the real action.
 */
async function ensureDesks(): Promise<void> {
  const passwordHash = await bcrypt.hash("e2e-password", 10);
  const admin = await db.user.upsert({
    where: { email: DESK_EMAILS.admin },
    update: { role: Role.ADMIN, active: true },
    create: {
      email: DESK_EMAILS.admin,
      name: "E2E Admin",
      role: Role.ADMIN,
      passwordHash,
    },
  });
  registerDesk("admin", admin);
  asAdmin();

  for (const name of ["manager", "chef", "store", "delivery", "accounts"] as DeskName[]) {
    const email = DESK_EMAILS[name];
    let user = await db.user.findUnique({ where: { email } });
    if (!user) {
      mustOk(
        await createUser({
          email,
          name: `E2E ${name}`,
          password: "e2e-password",
          role: DESK_ROLES[name],
        }),
        `create ${name}`,
      );
      user = await db.user.findUniqueOrThrow({ where: { email } });
    }
    registerDesk(name, user);
  }
}

/** Master rows the full reset preserves on purpose but a repeatable seed
 *  must not inherit. Safe straight after the reset: nothing references them
 *  any more. */
async function clearKeptMasterData(): Promise<void> {
  await db.$transaction([
    db.orderTemplateItem.deleteMany(),
    db.orderTemplate.deleteMany(),
    db.recipeSubRecipe.deleteMany(),
    db.recipe.deleteMany(),
    db.dish.deleteMany(),
    db.customer.deleteMany(),
    db.customerGroup.deleteMany(),
    db.vendor.deleteMany(),
  ]);
}

/**
 * The real import script, run exactly as go-live runs it. Invoked as tsx
 * rather than `npm run catalogue:import` for one reason: that script passes
 * `--env-file=.env`, and .env points at the developer's own database.
 */
function importCatalogue(): void {
  execFileSync("npx", ["tsx", "scripts/import-catalogue.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "pipe",
    encoding: "utf8",
  });
}
