import "./db-url";

import { beforeAll, describe, expect, it } from "vitest";
import { Role, StockStore } from "@prisma/client";
import {
  adjustIngredientStock,
  confirmIngredientReturn,
  declareIngredientReturn,
  recordDirectIngredientIssue,
  recordIngredientReceipt,
  recordIngredientReturn,
} from "@/server/actions/inventory";
import { postInventoryAudit } from "@/server/actions/inventory-audit";
import { recordStockTransfer } from "@/server/actions/stock-transfer";
import {
  actingAs,
  asAdmin,
  asChef,
  asManager,
  asNobody,
  asStore,
  db,
  declareReturn,
  type DeskName,
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
 * Who may set a stock figure by hand. Adjustments and physical-count
 * postings are the two paths where a number is typed in with no event
 * behind it, so they are admin/manager only — the store keeper walks the
 * store and counts, a manager posts the correction.
 *
 * The other half of the rule matters just as much: locking those two down
 * must not have taken the store keeper's own daily work with them.
 */

let ingredientId: string;
let fnbItemId: string;

/** Assert an action refused for the ROLE, not because the input was wrong. */
async function refusedByRole(
  desk: DeskName | "nobody",
  fn: () => Promise<unknown>,
): Promise<string> {
  if (desk === "nobody") {
    asNobody();
    return expectRefused(fn);
  }
  return actingAs(desk, () => expectRefused(fn));
}

const adjustment = () => ({ ingredientId, delta: "1", reason: "found behind the freezer" });
const audit = () => ({ lines: [{ ingredientId, physicalCount: "99" }] });

beforeAll(async () => {
  await ensureSeeded();
  ingredientId = await spareIngredient();
  fnbItemId = (
    await db.banquetItem.findFirstOrThrow({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true },
    })
  ).id;
  await stockUp(ingredientId, "50", "20");
});

describe("setting a stock figure by hand", () => {
  it("is refused for the store keeper and everyone below", async () => {
    const before = await read.onHand(ingredientId);

    for (const desk of ["store", "chef", "accounts", "delivery"] as const) {
      // The message names the gate, so a refusal can't be mistaken for a
      // validation failure that happened to come back false.
      expect(await refusedByRole(desk, () => adjustIngredientStock(adjustment()))).toBe(
        `Requires one of: ${Role.ADMIN}, ${Role.MANAGER}`,
      );
      expect(await refusedByRole(desk, () => postInventoryAudit(audit()))).toBe(
        `Requires one of: ${Role.ADMIN}, ${Role.MANAGER}`,
      );
    }
    expect(await refusedByRole("nobody", () => adjustIngredientStock(adjustment()))).toMatch(
      /not signed in/i,
    );
    expect(await refusedByRole("nobody", () => postInventoryAudit(audit()))).toMatch(
      /not signed in/i,
    );

    expectDecimal(await read.onHand(ingredientId), before, "on hand — nothing was adjusted");
  });

  it("is allowed for admin and manager, and posts a real correction", async () => {
    asManager();
    mustOk(
      await adjustIngredientStock({ ingredientId, delta: "-2", reason: "spoiled" }),
      "manager writes off two",
    );
    expectDecimal(await read.onHand(ingredientId), "48", "on hand after the manager's write-off");

    asAdmin();
    const posted = mustOk(
      await postInventoryAudit({
        lines: [{ ingredientId, physicalCount: "45" }],
        notes: "monthly count",
      }),
      "admin posts the physical count",
    );
    expect(posted.changes).toHaveLength(1);
    expectDecimal(posted.changes[0].delta, "-3", "counted short by three");
    expectDecimal(await read.onHand(ingredientId), "45", "on hand set to the physical count");
  });
});

describe("the desks that keep their daily work", () => {
  /**
   * The hand-typed receipt left the store's hands alongside the adjustments
   * and the bulk count. Their route to stock is the GRN — receiving the
   * delivery against its PO — so the order, the goods and the supplier's
   * bill agree and the 3-way match has something to check. Everything
   * downstream of the shelf is still theirs.
   */
  it("no longer lets the store keeper type stock in by hand", async () => {
    const line = await spareIngredient();
    asStore();
    const why = await expectRefused(() =>
      recordIngredientReceipt({ ingredientId: line, qty: "30", unitCost: "10" }),
    );
    expect(why).toMatch(/Requires one of/);
    expectDecimal(await read.onHand(line), "0", "nothing reached the shelf");
  });

  it("lets the store keeper issue, return and transfer", async () => {
    const order = await placeCateringOrder();
    const line = await spareIngredient();
    // Stock arrives the way it now does — booked in by management, standing
    // in for the GRN that puts it on the shelf in production.
    await stockUp(line, "30", "10");

    asStore();
    const issueId = mustOk(
      await recordDirectIngredientIssue({ ingredientId: line, orderId: order.id, qty: "12" }),
      "store issues",
    ).id;
    mustOk(
      await recordIngredientReturn({
        returnedAt: istInput(new Date()),
        lines: [{ issueId, quantity: "2", reason: "unused" }],
      }),
      "store books a counter return",
    );
    mustOk(
      await recordStockTransfer({
        transferredAt: istInput(new Date()),
        fromStore: StockStore.KITCHEN,
        fromItemId: line,
        toStore: StockStore.FNB,
        toItemId: fnbItemId,
        quantity: "1",
        unitsAcknowledged: true,
      }),
      "store transfers to F&B",
    );
    // 30 in, 12 out, 2 back, 1 away.
    expectDecimal(await read.onHand(line), "19", "on hand after the store keeper's day");
  });

  it("lets accounts record a books-side receipt but not issue or transfer", async () => {
    const line = await spareIngredient();
    await actingAs("accounts", async () => {
      mustOk(
        await recordIngredientReceipt({ ingredientId: line, qty: "5", unitCost: "10" }),
        "accounts receives",
      );
    });
    expectDecimal(await read.onHand(line), "5", "on hand after the accounts receipt");

    const order = await placeCateringOrder();
    expect(
      await refusedByRole("accounts", () =>
        recordDirectIngredientIssue({ ingredientId: line, orderId: order.id, qty: "1" }),
      ),
    ).toMatch(/Requires one of/);
    expect(
      await refusedByRole("accounts", () =>
        recordStockTransfer({
          transferredAt: istInput(new Date()),
          fromStore: StockStore.KITCHEN,
          fromItemId: line,
          toStore: StockStore.FNB,
          toItemId: fnbItemId,
          quantity: "1",
          unitsAcknowledged: true,
        }),
      ),
    ).toMatch(/Requires one of/);
    expectDecimal(await read.onHand(line), "5", "on hand — neither refusal moved anything");
  });

  it("keeps declaring and confirming on opposite sides of the counter", async () => {
    const line = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(line, "10", "10");
    const issueId = await issueStock(order.id, line, "6");

    // The chef declares; the store must not be able to declare on their behalf.
    expect(
      await refusedByRole("store", () =>
        declareIngredientReturn({
          returnedAt: istInput(new Date()),
          lines: [{ issueId, quantity: "2", reason: "unused" }],
        }),
      ),
    ).toMatch(/Requires one of/);
    const declared = await declareReturn(issueId, "2");

    // The store confirms; the chef must not be able to book their own stock in.
    expect(
      await refusedByRole("chef", () =>
        confirmIngredientReturn({
          id: declared.id,
          lines: [{ lineId: declared.lineId, receivedQty: "2" }],
        }),
      ),
    ).toMatch(/Requires one of/);
    expectDecimal(await read.onHand(line), "4", "on hand — the chef confirmed nothing");

    asStore();
    mustOk(
      await confirmIngredientReturn({
        id: declared.id,
        lines: [{ lineId: declared.lineId, receivedQty: "2" }],
      }),
      "store confirms",
    );
    expectDecimal(await read.onHand(line), "6", "on hand once the store confirms");

    // …and the chef may not move stock any of the other ways either.
    asChef();
    for (const attempt of [
      () => recordIngredientReceipt({ ingredientId: line, qty: "1", unitCost: "1" }),
      () => recordDirectIngredientIssue({ ingredientId: line, orderId: order.id, qty: "1" }),
      () =>
        recordIngredientReturn({
          returnedAt: istInput(new Date()),
          lines: [{ issueId, quantity: "1", reason: "unused" }],
        }),
      () =>
        recordStockTransfer({
          transferredAt: istInput(new Date()),
          fromStore: StockStore.KITCHEN,
          fromItemId: line,
          toStore: StockStore.FNB,
          toItemId: fnbItemId,
          quantity: "1",
          unitsAcknowledged: true,
        }),
    ]) {
      expect(await expectRefused(attempt)).toMatch(/Requires one of/);
    }
    expectDecimal(await read.onHand(line), "6", "on hand — the chef moved nothing");
  });
});
