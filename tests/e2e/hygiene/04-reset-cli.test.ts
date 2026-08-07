import "../harness/database-url";

import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { StockStore } from "@prisma/client";
import { db } from "@/server/db";
import {
  declareIngredientReturn,
  recordDirectIngredientIssue,
} from "@/server/actions/inventory";
import { recordStockTransfer } from "@/server/actions/stock-transfer";
import {
  asChef,
  asStore,
  chefAccepts,
  ensureSeeded,
  INGREDIENT_CODES,
  istInput,
  mustOk,
  placeCateringOrder,
  seeded,
} from "../harness";

/**
 * Finding 5: `npm run db:reset-transactional` — the CLI twin of the in-app
 * reset — never deleted ingredient returns or stock transfers. A kitchen
 * return holds a RESTRICT foreign key on the issue it reverses, so the
 * script died on the FK the moment any database held one: exactly the
 * databases a go-live reset is aimed at.
 *
 * This file wipes the database by design, so it runs last.
 */

/** The reset script, run the way go-live runs it. Throws on a non-zero exit. */
function runResetCli(): string {
  return execFileSync("npx", ["tsx", "prisma/reset-transactional.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "pipe",
    encoding: "utf8",
  });
}

beforeAll(async () => {
  await ensureSeeded();
  const fixtures = seeded();

  // A kitchen return: the store issues stock to an order, the chef declares
  // some of it coming back. The declaration alone is enough — the FK that
  // blocked the script is on the line, not on the confirmation.
  const order = await placeCateringOrder({ headcount: 50, packageTotal: "100000" });
  await chefAccepts(order.id);
  asStore();
  const issue = mustOk(
    await recordDirectIngredientIssue({
      ingredientId: fixtures.ingredients.plentiful,
      orderId: order.id,
      qty: "5",
    }),
    "issue stock",
  );
  asChef();
  mustOk(
    await declareIngredientReturn({
      returnedAt: istInput(new Date()),
      lines: [{ issueId: issue.id, quantity: "2", reason: "unused at the event" }],
    }),
    "declare the return",
  );

  // An inter-store transfer: a movement document with nothing to cascade it.
  const banquetItem = await db.banquetItem.findFirstOrThrow({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  asStore();
  mustOk(
    await recordStockTransfer({
      transferredAt: istInput(new Date()),
      fromStore: StockStore.KITCHEN,
      fromItemId: fixtures.ingredients.plentiful,
      toStore: StockStore.FNB,
      toItemId: banquetItem.id,
      quantity: "1",
      unitsAcknowledged: true,
    }),
    "transfer to the F&B store",
  );
});

describe("the CLI reset on a database that holds kitchen returns", () => {
  it("has something to trip over", async () => {
    expect(await db.ingredientReturn.count()).toBeGreaterThan(0);
    expect(await db.ingredientReturnLine.count()).toBeGreaterThan(0);
    expect(await db.stockTransfer.count()).toBeGreaterThan(0);
  });

  it("runs to completion instead of dying on the foreign key", () => {
    expect(() => runResetCli()).not.toThrow();
  });

  it("leaves no returns, transfers or orders behind", async () => {
    expect(await db.ingredientReturnLine.count()).toBe(0);
    expect(await db.ingredientReturn.count()).toBe(0);
    expect(await db.stockTransfer.count()).toBe(0);
    expect(await db.ingredientIssue.count()).toBe(0);
    expect(await db.order.count()).toBe(0);
  });
});
