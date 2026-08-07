import "./db-url";

import { beforeAll, describe, expect, it } from "vitest";
import { StockStore } from "@prisma/client";
import { Decimal } from "decimal.js";
import {
  adjustIngredientStock,
  confirmIngredientReturn,
  listIngredientMovements,
} from "@/server/actions/inventory";
import { recordStockTransfer } from "@/server/actions/stock-transfer";
import { computeOrderPnL } from "@/lib/pnl";
import { getStockLedger, type LedgerRow } from "@/server/reports/stock-ledger";
import {
  asAdmin,
  asStore,
  db,
  declareReturn,
  ensureSeeded,
  expectDecimal,
  istInput,
  issueStock,
  mustOk,
  placeCateringOrder,
  read,
  seeded,
  spareIngredient,
  stockUp,
} from "./harness";

/**
 * The reports have to agree with the shelf. A movement missing from the
 * ledger — or one showing in it that never happened — is the failure mode
 * this area has already suffered once, and it is invisible until someone
 * counts the store and cannot explain the difference.
 *
 * So: run a mixed sequence (receipt, issue, declared-then-confirmed return,
 * transfer out, manual adjustment) and hold every report against the one
 * number that cannot lie, `Ingredient.onHandQty`.
 */

const from = new Date(Date.now() - 60 * 60 * 1000);
const to = new Date(Date.now() + 60 * 60 * 1000);

let fnbItemId: string;

async function ledgerRow(ingredientId: string): Promise<LedgerRow> {
  const { sku } = await db.ingredient.findUniqueOrThrow({
    where: { id: ingredientId },
    select: { sku: true },
  });
  const { rows } = await getStockLedger("kitchen", from, to);
  const row = rows.find((r) => r.sku === sku);
  if (!row) throw new Error(`Stock ledger has no row for ${sku} — it moved, so it must be there.`);
  return row;
}

/**
 * Receipt, issue, return, transfer out, adjustment — one of everything that
 * touches on-hand, so a report that drops any single kind is caught.
 */
async function mixedSequence(ingredientId: string) {
  const order = await placeCateringOrder();
  await stockUp(ingredientId, "10", "100");
  const issueId = await issueStock(order.id, ingredientId, "6");

  const declared = await declareReturn(issueId, "2");
  asStore();
  mustOk(
    await confirmIngredientReturn({
      id: declared.id,
      lines: [{ lineId: declared.lineId, receivedQty: "2" }],
    }),
    "confirm return",
  );

  mustOk(
    await recordStockTransfer({
      transferredAt: istInput(new Date()),
      fromStore: StockStore.KITCHEN,
      fromItemId: ingredientId,
      toStore: StockStore.FNB,
      toItemId: fnbItemId,
      quantity: "3",
      unitsAcknowledged: true,
    }),
    "transfer to F&B",
  );

  asAdmin();
  mustOk(
    await adjustIngredientStock({ ingredientId, delta: "-1", reason: "spoilage" }),
    "write off one unit",
  );

  return { orderId: order.id, issueId };
}

beforeAll(async () => {
  await ensureSeeded();
  fnbItemId = (
    await db.banquetItem.findFirstOrThrow({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true },
    })
  ).id;
});

describe("the stock ledger after a mixed sequence", () => {
  it("closes where an item with no opening stock actually stands", async () => {
    const ingredientId = await spareIngredient();
    await mixedSequence(ingredientId);

    // 10 in, 6 out, 2 back, 3 transferred away, 1 written off.
    const onHand = await read.onHand(ingredientId);
    expectDecimal(onHand, "2", "on hand after the mixed sequence");

    const row = await ledgerRow(ingredientId);
    expectDecimal(row.opening, "0", "ledger opening");
    expectDecimal(row.inQty, "12", "ledger in (receipt + confirmed return)");
    expectDecimal(row.outQty, "9", "ledger out (issue + transfer away)");
    expectDecimal(row.adjustQty, "-1", "ledger adjustment");
    expectDecimal(row.closing, onHand, "ledger closing vs actual on hand");
  });

  it("closes where an item WITH opening stock actually stands", async () => {
    // The catalogue's opening quantity is stock the store is holding: it
    // sits on the item row with no movement document behind it, so a ledger
    // that only adds up movements starts the item at zero and every closing
    // balance after it is short by the opening figure.
    const ingredientId = seeded().ingredients.plentiful;
    const opening = (
      await db.ingredient.findUniqueOrThrow({
        where: { id: ingredientId },
        select: { openingQty: true },
      })
    ).openingQty;
    expect(opening.gt(0)).toBe(true);

    await mixedSequence(ingredientId);

    const onHand = await read.onHand(ingredientId);
    expectDecimal(onHand, opening.plus(2).toString(), "on hand after the mixed sequence");

    const row = await ledgerRow(ingredientId);
    // Nothing moved before the window, so the opening balance is exactly the
    // stock the item started life with.
    expectDecimal(row.opening, opening.toString(), "ledger opening vs the item's opening stock");
    expectDecimal(row.closing, onHand, "ledger closing vs actual on hand");
  });
});

describe("the per-item movement ledger", () => {
  it("adds up to the item's on-hand, and shows no movement that never happened", async () => {
    const ingredientId = await spareIngredient();
    const { issueId } = await mixedSequence(ingredientId);

    // A declaration the store has not confirmed: a promise, not a movement.
    await declareReturn(issueId, "1", "still sitting in the kitchen");

    const onHand = await read.onHand(ingredientId);
    expectDecimal(onHand, "2", "on hand — the declaration moved nothing");

    const movements = await listIngredientMovements(ingredientId);
    expect(movements.map((m) => m.kind).sort()).toEqual([
      "ADJUSTMENT",
      "ISSUE",
      "RECEIPT",
      "RETURN",
      "TRANSFER",
    ]);

    const opening = (
      await db.ingredient.findUniqueOrThrow({
        where: { id: ingredientId },
        select: { openingQty: true },
      })
    ).openingQty;
    const walked = movements.reduce((s, m) => s.plus(new Decimal(m.qty)), new Decimal(opening));
    expectDecimal(walked, onHand, "opening + every listed movement vs actual on hand");
  });
});

describe("order profitability", () => {
  it("credits confirmed returns only, at the cost the stock was issued at", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "80");
    const issueId = await issueStock(order.id, ingredientId, "5");

    const foodCost = async () => (await computeOrderPnL(order.id))!.ingredientCost.actual.toString();
    expectDecimal(await foodCost(), "400", "food cost after the issue");

    const declared = await declareReturn(issueId, "2");
    expectDecimal(await foodCost(), "400", "food cost while the return is only declared");

    asStore();
    mustOk(
      await confirmIngredientReturn({
        id: declared.id,
        lines: [{ lineId: declared.lineId, receivedQty: "2" }],
      }),
      "confirm return",
    );
    expectDecimal(await foodCost(), "240", "food cost once the return is confirmed");

    // A second declaration left pending must not move the figure again.
    await declareReturn(issueId, "3", "the rest is on its way");
    expectDecimal(await foodCost(), "240", "food cost with a second declaration pending");
  });
});
