import "./db-url";

import { beforeAll, describe, expect, it } from "vitest";
import { IngredientReturnStatus } from "@prisma/client";
import {
  confirmIngredientReturn,
  declareIngredientReturn,
  rejectIngredientReturnDeclaration,
} from "@/server/actions/inventory";
import { computeOrderPnL } from "@/lib/pnl";
import { getStockLedger } from "@/server/reports/stock-ledger";
import {
  asChef,
  asManager,
  asStore,
  db,
  declareReturn,
  desk,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  istInput,
  issueStock,
  mustOk,
  placeCateringOrder,
  read,
  spareIngredient,
  stockUp,
} from "./harness";

/**
 * The two-step kitchen return: the chef DECLARES what is coming back, the
 * store CONFIRMS what actually turned up. Only the second step is a
 * movement — the first must leave stock, the order's food cost and every
 * report exactly where they were.
 *
 * The money question underneath: a return credits the order at the cost the
 * stock was ISSUED at, never at today's moving average, or an event booked
 * before a price rise reads cheaper (or dearer) than it was.
 */

/** Every movement these scenarios make lands inside this window. */
const from = new Date(Date.now() - 60 * 60 * 1000);
const to = new Date(Date.now() + 60 * 60 * 1000);

/** What the stock-ledger report says this item closed at. */
async function ledgerClosing(ingredientId: string): Promise<number> {
  const { sku } = await db.ingredient.findUniqueOrThrow({
    where: { id: ingredientId },
    select: { sku: true },
  });
  const { rows } = await getStockLedger("kitchen", from, to);
  return rows.find((r) => r.sku === sku)?.closing ?? 0;
}

/** The order's food cost as profitability reads it: issued, less what came back. */
async function foodCost(orderId: string): Promise<string> {
  const pnl = await computeOrderPnL(orderId);
  if (!pnl) throw new Error(`No P&L for order ${orderId}`);
  return pnl.ingredientCost.actual.toString();
}

function returnDoc(id: string) {
  return db.ingredientReturn.findUniqueOrThrow({
    where: { id },
    include: { lines: true },
  });
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("chef declares, store confirms", () => {
  it("a declaration moves nothing — not stock, not food cost, not the ledger", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "100");
    const issueId = await issueStock(order.id, ingredientId, "6");

    expectDecimal(await read.onHand(ingredientId), "4", "on hand after issue");
    expectDecimal(await foodCost(order.id), "600", "food cost after issue");

    const { id } = await declareReturn(issueId, "2");

    expectDecimal(await read.onHand(ingredientId), "4", "on hand after declaration");
    expectDecimal(await foodCost(order.id), "600", "food cost after declaration");
    expectDecimal(await ledgerClosing(ingredientId), "4", "ledger closing after declaration");

    const doc = await returnDoc(id);
    expect(doc.status).toBe(IngredientReturnStatus.DECLARED);
    expect(doc.confirmedAt).toBeNull();
    expect(doc.confirmedById).toBeNull();
    // Both figures start at what the chef said; the cost is snapshotted off
    // the issue at declaration time, not looked up later.
    expectDecimal(doc.lines[0].quantity, "2", "declared line quantity");
    expectDecimal(doc.lines[0].declaredQuantity, "2", "declaredQuantity");
    expectDecimal(doc.lines[0].unitCost, "100", "line unit cost");
  });

  it("the store confirms a different quantity — stock returns, both figures survive", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "100");
    const issueId = await issueStock(order.id, ingredientId, "6");
    const { id, lineId } = await declareReturn(issueId, "2");

    // Only 1.5 kg physically turned up at the counter.
    asStore();
    mustOk(
      await confirmIngredientReturn({
        id,
        note: "short by half a kg",
        lines: [{ lineId, receivedQty: "1.5" }],
      }),
      "confirm return",
    );

    expectDecimal(await read.onHand(ingredientId), "5.5", "on hand after confirmation");
    expectDecimal(await foodCost(order.id), "450", "food cost after confirmation");
    expectDecimal(await ledgerClosing(ingredientId), "5.5", "ledger closing after confirmation");

    const doc = await returnDoc(id);
    expect(doc.status).toBe(IngredientReturnStatus.CONFIRMED);
    expect(doc.confirmedById).toBe(desk("store").id);
    expect(doc.confirmationNote).toBe("short by half a kg");
    // The discrepancy is the whole point of confirming separately: what was
    // promised and what arrived both stay readable on the row.
    expectDecimal(doc.lines[0].declaredQuantity, "2", "declared");
    expectDecimal(doc.lines[0].quantity, "1.5", "received");

    expect(await read.auditActions("IngredientReturn", id)).toEqual([
      "INGREDIENT_RETURN_DECLARED",
      "INGREDIENT_RETURN_CONFIRMED",
    ]);
  });

  it("credits the order at the issue cost, not at today's moving average", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();

    // 10 @ ₹100, four go out to the event at ₹100.
    await stockUp(ingredientId, "10", "100");
    const issueId = await issueStock(order.id, ingredientId, "4");
    expectDecimal(await read.onHand(ingredientId), "6", "on hand after issue");
    expectDecimal(await foodCost(order.id), "400", "food cost after issue");

    // The price moves under it: 10 more @ ₹150 → (6×100 + 10×150) / 16 = 131.25.
    await stockUp(ingredientId, "10", "150");
    const moved = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    expectDecimal(moved.avgUnitCost, "131.25", "average after the second receipt");

    const { id, lineId } = await declareReturn(issueId, "4");
    asStore();
    mustOk(
      await confirmIngredientReturn({ id, lines: [{ lineId, receivedQty: "4" }] }),
      "confirm return",
    );

    const doc = await returnDoc(id);
    expectDecimal(doc.lines[0].unitCost, "100", "credited unit cost");
    // The event is charged nothing net: 4 × ₹100 out, 4 × ₹100 back. Valuing
    // the credit at 131.25 would have handed the order ₹125 it never spent.
    expectDecimal(await foodCost(order.id), "0", "food cost after the return");

    // …and stock is re-weighted at the cost that came back:
    // (16 × 131.25 + 4 × 100) / 20 = 125, i.e. the ₹2,500 actually bought.
    const after = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    expectDecimal(after.onHandQty, "20", "on hand after the return");
    expectDecimal(after.avgUnitCost, "125", "average after the return");
    expectDecimal(
      after.onHandQty.times(after.avgUnitCost),
      "2500",
      "stock value after the return",
    );
  });
});

describe("declarations that never become movements", () => {
  it("the store turns one down with a reason, and the quantity is free again", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "100");
    const issueId = await issueStock(order.id, ingredientId, "5");
    const { id } = await declareReturn(issueId, "5");

    // All 5 are promised, so there is nothing left to promise.
    asChef();
    const queued = await expectRefused(() =>
      declareIngredientReturn({
        returnedAt: istInput(new Date()),
        lines: [{ issueId, quantity: "1", reason: "more leftovers" }],
      }),
    );
    expect(queued).toMatch(/already declared and waiting on the store/i);

    asStore();
    expect(await expectRefused(() => rejectIngredientReturnDeclaration(id, "  "))).toMatch(
      /say why/i,
    );
    mustOk(
      await rejectIngredientReturnDeclaration(id, "nothing arrived at the counter"),
      "reject declaration",
    );

    const doc = await returnDoc(id);
    expect(doc.status).toBe(IngredientReturnStatus.REJECTED);
    expect(doc.rejectionReason).toBe("nothing arrived at the counter");
    expect(doc.rejectedById).toBe(desk("store").id);
    expectDecimal(await read.onHand(ingredientId), "5", "on hand — a rejection moves nothing");
    expectDecimal(await foodCost(order.id), "500", "food cost — a rejection credits nothing");

    // A dead promise stops holding the quantity: the chef can declare it again.
    const second = await declareReturn(issueId, "5", "re-declared after the store refused");
    expect((await returnDoc(second.id)).status).toBe(IngredientReturnStatus.DECLARED);

    // …and a rejected document can no longer be confirmed into stock.
    asStore();
    const line = await db.ingredientReturnLine.findFirstOrThrow({ where: { returnId: id } });
    expect(
      await expectRefused(() =>
        confirmIngredientReturn({ id, lines: [{ lineId: line.id, receivedQty: "5" }] }),
      ),
    ).toMatch(/turned down/i);
  });

  it("a chef withdraws their own declaration but not somebody else's", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "100");
    const issueId = await issueStock(order.id, ingredientId, "8");

    const mine = await declareReturn(issueId, "2");
    asChef();
    mustOk(
      await rejectIngredientReturnDeclaration(mine.id, "miscounted — keeping it in the kitchen"),
      "chef withdraws own declaration",
    );
    const withdrawn = await returnDoc(mine.id);
    expect(withdrawn.status).toBe(IngredientReturnStatus.REJECTED);
    // Withdrawn vs refused is not a second state — it is recordedBy === rejectedBy.
    expect(withdrawn.rejectedById).toBe(withdrawn.recordedById);
    expect(withdrawn.rejectedById).toBe(desk("chef").id);

    // The manager raises one; the chef may not overrule it.
    asManager();
    const theirs = mustOk(
      await declareIngredientReturn({
        returnedAt: istInput(new Date()),
        lines: [{ issueId, quantity: "2", reason: "manager logged the leftovers" }],
      }),
      "manager declares",
    );
    asChef();
    expect(
      await expectRefused(() => rejectIngredientReturnDeclaration(theirs.id, "not mine to cancel")),
    ).toMatch(/only withdraw a declaration you raised yourself/i);
    expect((await returnDoc(theirs.id)).status).toBe(IngredientReturnStatus.DECLARED);

    expectDecimal(await read.onHand(ingredientId), "2", "on hand — nothing moved either way");
  });
});
