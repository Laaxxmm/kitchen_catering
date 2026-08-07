import "./db-url";

import { beforeAll, describe, expect, it } from "vitest";
import { IngredientReturnStatus } from "@prisma/client";
import {
  adjustIngredientStock,
  confirmIngredientReturn,
  declareIngredientReturn,
  listDeclarableIssues,
  listReturnableIssues,
  recordDirectIngredientIssue,
  recordIngredientReturn,
} from "@/server/actions/inventory";
import {
  asAdmin,
  asChef,
  asStore,
  db,
  declareReturn,
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
 * The ceiling: never more back than went out, net of what has already come
 * back. Two desks can push against it at once — the chef queueing
 * declarations and the store booking walk-in returns at the counter — and
 * the design deliberately counts them differently. A pending declaration
 * holds quantity at the chef's desk (so two promises can't be made for the
 * same stock) but holds nothing at the counter (a promise has moved no
 * stock, so it must not block real goods arriving). The one thing neither
 * ordering may do is put more back on the shelf than left it.
 *
 * The floor is the same guard read the other way: nothing may take a store
 * below zero either, whatever route it takes.
 */

/** Declare against one issue, as the chef, expecting a refusal. */
function declareRefused(issueId: string, quantity: string) {
  asChef();
  return expectRefused(() =>
    declareIngredientReturn({
      returnedAt: istInput(new Date()),
      lines: [{ issueId, quantity, reason: "leftovers" }],
    }),
  );
}

/** The store's direct counter return — no declaration behind it. */
function directReturn(issueId: string, quantity: string) {
  asStore();
  return recordIngredientReturn({
    returnedAt: istInput(new Date()),
    lines: [{ issueId, quantity, reason: "walked in at the counter" }],
  });
}

function confirmLine(id: string, lineId: string, receivedQty: string) {
  asStore();
  return confirmIngredientReturn({ id, lines: [{ lineId, receivedQty }] });
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("two declarations against one issue", () => {
  it("share one ceiling and together return exactly what went out", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "12", "50");
    const issueId = await issueStock(order.id, ingredientId, "10");

    const first = await declareReturn(issueId, "6");
    // 6 of the 10 are already promised — a second declaration sees 4 left.
    expect(await declareRefused(issueId, "5")).toMatch(/Only 4 .* can still be declared/i);
    const second = await declareReturn(issueId, "4");
    expect(await declareRefused(issueId, "0.5")).toMatch(/nothing left to send back/i);

    mustOk(await confirmLine(first.id, first.lineId, "6"), "confirm first");
    mustOk(await confirmLine(second.id, second.lineId, "4"), "confirm second");

    // 12 in, 10 out, 10 back — exactly the opening figure, never more.
    expectDecimal(await read.onHand(ingredientId), "12", "on hand after both confirmations");
    expect(await declareRefused(issueId, "0.5")).toMatch(/nothing left to send back/i);
  });
});

describe("a declaration plus a direct store return", () => {
  it("cannot together put back more than the issue took out", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "50");
    const issueId = await issueStock(order.id, ingredientId, "10");
    expectDecimal(await read.onHand(ingredientId), "0", "on hand after issue");

    // The chef promises 6. By design that holds nothing at the counter: the
    // store keeper is looking at real goods, and a promise has moved none.
    const declared = await declareReturn(issueId, "6");
    mustOk(await directReturn(issueId, "10"), "direct return of the whole issue");
    expectDecimal(await read.onHand(ingredientId), "10", "on hand after the direct return");

    // Now the promise has nothing left to land on — and this is the moment
    // that matters, because confirming it is what would have moved stock.
    expect(await confirmLine(declared.id, declared.lineId, "6")).toEqual({
      ok: false,
      error: expect.stringMatching(/already been returned in full/i),
    });
    expectDecimal(await read.onHand(ingredientId), "10", "on hand — the confirmation moved nothing");
    expect((await db.ingredientReturn.findUniqueOrThrow({ where: { id: declared.id } })).status).toBe(
      IngredientReturnStatus.DECLARED,
    );
  });

  it("lets the store confirm more than was declared, but never more than was issued", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "50");
    const issueId = await issueStock(order.id, ingredientId, "10");

    // The chef said 3; 5 turned up. The store counts what it receives.
    const light = await declareReturn(issueId, "3");
    mustOk(await confirmLine(light.id, light.lineId, "5"), "confirm above the declared figure");
    expectDecimal(await read.onHand(ingredientId), "5", "on hand after the generous confirmation");
    const doc = await db.ingredientReturn.findUniqueOrThrow({
      where: { id: light.id },
      include: { lines: true },
    });
    expectDecimal(doc.lines[0].declaredQuantity, "3", "declared");
    expectDecimal(doc.lines[0].quantity, "5", "received");

    // 5 of 10 are back, so 5 remain — and the issue is still the ceiling.
    const rest = await declareReturn(issueId, "5");
    expect(await confirmLine(rest.id, rest.lineId, "6")).toEqual({
      ok: false,
      error: expect.stringMatching(/Only 5 .* still returnable/i),
    });
    expectDecimal(await read.onHand(ingredientId), "5", "on hand — the over-confirmation moved nothing");
    mustOk(await confirmLine(rest.id, rest.lineId, "5"), "confirm the remainder");
    expectDecimal(await read.onHand(ingredientId), "10", "on hand once the issue is fully back");
  });
});

describe("the direct counter path", () => {
  it("caps at what the issue still has outstanding", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "50");
    const issueId = await issueStock(order.id, ingredientId, "10");

    mustOk(await directReturn(issueId, "7"), "first counter return");
    expect(await expectRefused(() => directReturn(issueId, "4"))).toMatch(
      /Only 3 .* still returnable/i,
    );
    mustOk(await directReturn(issueId, "3"), "second counter return");
    expect(await expectRefused(() => directReturn(issueId, "0.001"))).toMatch(
      /already been returned in full/i,
    );
    expectDecimal(await read.onHand(ingredientId), "10", "on hand after the counter returns");
  });

  it("refuses a zero or negative quantity on either path", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "50");
    const issueId = await issueStock(order.id, ingredientId, "4");

    expect(await expectRefused(() => directReturn(issueId, "0"))).toMatch(/greater than 0/i);
    expect(await expectRefused(() => directReturn(issueId, "-2"))).toMatch(/greater than 0/i);
    expect(await declareRefused(issueId, "0")).toMatch(/greater than 0/i);
    expect(await declareRefused(issueId, "-2")).toMatch(/greater than 0/i);
    expect(await declareRefused(issueId, "")).toMatch(/greater than 0/i);
    expectDecimal(await read.onHand(ingredientId), "6", "on hand — nothing was booked in");
  });
});

describe("the floor", () => {
  it("refuses to issue, or adjust, a store below zero — and an adjustment never re-prices", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "10", "50");

    asStore();
    expect(
      await expectRefused(() =>
        recordDirectIngredientIssue({ ingredientId, orderId: order.id, qty: "11" }),
      ),
    ).toMatch(/Insufficient stock. On hand: 10, requested: 11/i);

    asAdmin();
    expect(
      await expectRefused(() =>
        adjustIngredientStock({ ingredientId, delta: "-11", reason: "write-off" }),
      ),
    ).toMatch(/cannot be negative/i);
    expect(
      await expectRefused(() =>
        adjustIngredientStock({ ingredientId, newQty: "10", reason: "recount" }),
      ),
    ).toMatch(/No change/i);
    expectDecimal(await read.onHand(ingredientId), "10", "on hand — neither refusal moved anything");

    // A correction is a quantity edit with no purchase behind it, so it must
    // leave the valuation alone: 7 units still cost ₹50 each.
    mustOk(
      await adjustIngredientStock({ ingredientId, newQty: "7", reason: "counted short" }),
      "adjust down to the counted figure",
    );
    const after = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    expectDecimal(after.onHandQty, "7", "on hand after the correction");
    expectDecimal(after.avgUnitCost, "50", "average cost after the correction");
  });
});

describe("the pickers the two return screens read", () => {
  it("offer exactly what each desk may still claim", async () => {
    const ingredientId = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(ingredientId, "12", "50");
    const issueId = await issueStock(order.id, ingredientId, "10");

    const done = await declareReturn(issueId, "2");
    mustOk(await confirmLine(done.id, done.lineId, "2"), "confirm two");
    await declareReturn(issueId, "6");

    // The store sees the hard ceiling — a promise has moved nothing, so it
    // must not stop real goods being booked in at the counter.
    asStore();
    const forStore = (await listReturnableIssues({ orderId: order.id })).find(
      (i) => i.id === issueId,
    )!;
    expectDecimal(forStore.returnable, "8", "still returnable at the counter");
    expectDecimal(forStore.pendingDeclared, "6", "declared and waiting");

    // The chef sees what is not already promised, so they can't queue a
    // second promise against the same stock.
    asChef();
    const forChef = (await listDeclarableIssues({ orderId: order.id })).find(
      (i) => i.id === issueId,
    )!;
    expectDecimal(forChef.declarable, "2", "still declarable at the kitchen desk");
  });
});

describe("confirming a multi-line declaration", () => {
  it("needs an answer for every line, and books in only what arrived", async () => {
    const [first, second] = [await spareIngredient(), await spareIngredient()];
    const order = await placeCateringOrder();
    await stockUp(first, "10", "50");
    await stockUp(second, "10", "80");
    const issueA = await issueStock(order.id, first, "6");
    const issueB = await issueStock(order.id, second, "6");

    asChef();
    const { id } = mustOk(
      await declareIngredientReturn({
        returnedAt: istInput(new Date()),
        lines: [
          { issueId: issueA, quantity: "2", reason: "unused" },
          { issueId: issueB, quantity: "2", reason: "unused" },
        ],
      }),
      "two-line declaration",
    );
    const lines = await db.ingredientReturnLine.findMany({
      where: { returnId: id },
      orderBy: { unitCost: "asc" },
      select: { id: true, issueId: true },
    });
    expect(lines).toHaveLength(2);

    asStore();
    expect(
      await expectRefused(() =>
        confirmIngredientReturn({ id, lines: [{ lineId: lines[0].id, receivedQty: "2" }] }),
      ),
    ).toMatch(/every line/i);
    expectDecimal(await read.onHand(first), "4", "on hand — the half-answer booked nothing");

    // One line arrived, the other did not. Zero is a real answer.
    const lineA = lines.find((l) => l.issueId === issueA)!;
    const lineB = lines.find((l) => l.issueId === issueB)!;
    mustOk(
      await confirmIngredientReturn({
        id,
        lines: [
          { lineId: lineA.id, receivedQty: "2" },
          { lineId: lineB.id, receivedQty: "0" },
        ],
      }),
      "confirm one line, nothing on the other",
    );
    expectDecimal(await read.onHand(first), "6", "the line that arrived");
    expectDecimal(await read.onHand(second), "4", "the line that did not");

    // The empty line stays claimable: nothing was ever booked against it.
    const again = await declareReturn(issueB, "2", "turned up the next morning");
    mustOk(await confirmLine(again.id, again.lineId, "2"), "confirm the late arrival");
    expectDecimal(await read.onHand(second), "6", "on hand once the late line lands");
  });
});
