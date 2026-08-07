import "./db-url";

import { beforeAll, describe, expect, it } from "vitest";
import { StockStore } from "@prisma/client";
import {
  adjustIngredientStock,
  confirmIngredientReturn,
} from "@/server/actions/inventory";
import { recordStockTransfer } from "@/server/actions/stock-transfer";
import { getStockLedger } from "@/server/reports/stock-ledger";
import {
  asAdmin,
  asStore,
  db,
  declareReturn,
  ensureSeeded,
  expectDecimal,
  freshSlate,
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
 * Go-live day: the client trials the system, then an admin presses the
 * clean-slate button and the real work starts on an empty database. Every
 * stock movement this suite exercises has to survive that — meaning it has
 * to be cleared BY it, and leave the store reading exactly its opening
 * stock afterwards.
 */

beforeAll(async () => {
  await ensureSeeded();
});

describe("the transactional clean slate", () => {
  it("clears kitchen returns and transfers, and rewinds stock to opening", async () => {
    const spare = await spareIngredient();
    const stocked = seeded().ingredients.plentiful;
    const opening = (
      await db.ingredient.findUniqueOrThrow({
        where: { id: stocked },
        select: { openingQty: true },
      })
    ).openingQty;
    const fnbItemId = (
      await db.banquetItem.findFirstOrThrow({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true },
      })
    ).id;

    // A day's worth of history: receipt, issue, declared-and-confirmed
    // return, transfer to F&B, manual write-off.
    const order = await placeCateringOrder();
    await stockUp(spare, "10", "100");
    const issueId = await issueStock(order.id, spare, "6");
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
        fromItemId: stocked,
        toStore: StockStore.FNB,
        toItemId: fnbItemId,
        quantity: "3",
        unitsAcknowledged: true,
      }),
      "transfer to F&B",
    );
    asAdmin();
    mustOk(
      await adjustIngredientStock({ ingredientId: spare, delta: "-1", reason: "spoilage" }),
      "write off one",
    );

    // The admin presses the button.
    await freshSlate();

    // Nothing that moved stock may outlive the wipe: the stock figures are
    // rewound to opening, so a surviving movement document is a movement
    // with nothing behind it.
    expect(await db.ingredientReturnLine.count()).toBe(0);
    expect(await db.ingredientReturn.count()).toBe(0);
    expect(await db.ingredientIssue.count()).toBe(0);
    expect(await db.ingredientReceipt.count()).toBe(0);
    expect(await db.ingredientAdjustment.count()).toBe(0);
    expect(await db.stockTransfer.count()).toBe(0);

    expectDecimal(await read.onHand(spare), "0", "spare line back to nothing");
    expectDecimal(await read.onHand(stocked), opening.toString(), "stocked line back to opening");

    // And the ledger agrees: opening stock, no movements, closing = opening.
    const { rows } = await getStockLedger(
      "kitchen",
      new Date(Date.now() - 60 * 60 * 1000),
      new Date(Date.now() + 60 * 60 * 1000),
    );
    const { sku } = await db.ingredient.findUniqueOrThrow({
      where: { id: stocked },
      select: { sku: true },
    });
    const row = rows.find((r) => r.sku === sku);
    if (!row) throw new Error(`Stock ledger dropped ${sku}, which still holds opening stock.`);
    expectDecimal(row.inQty, "0", "ledger in after the wipe");
    expectDecimal(row.outQty, "0", "ledger out after the wipe");
    expectDecimal(row.closing, opening.toString(), "ledger closing after the wipe");
  });
});
