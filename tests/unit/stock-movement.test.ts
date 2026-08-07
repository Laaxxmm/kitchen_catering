import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  checkDeclareQty,
  checkReturnQty,
  checkTransferQty,
  itemsStillOutByOrder,
  remainingReturnable,
} from "@/lib/stock-movement";
import { newMovingAverage } from "@/lib/inventory-cost";

// These guards are the whole reason the two new movements are safe to give
// the store: without the ceiling a return invents stock, and without the
// below-zero refusal a transfer drains a store past empty. Decimal maths
// throughout — 0.1 + 0.2 in floats is how a stock ledger starts drifting.

describe("remainingReturnable", () => {
  it("is what went out, less what already came back", () => {
    expect(remainingReturnable("5", "0").toString()).toBe("5");
    expect(remainingReturnable("5", "2").toString()).toBe("3");
    expect(remainingReturnable("5", "5").toString()).toBe("0");
  });

  it("holds exact decimals rather than drifting", () => {
    expect(remainingReturnable("0.3", "0.1").toString()).toBe("0.2");
  });

  it("never goes negative, even on a corrupt over-return", () => {
    expect(remainingReturnable("5", "7").toString()).toBe("0");
  });
});

describe("checkReturnQty", () => {
  const base = { issuedQty: "5", name: "Onions", unit: "kg" };

  it("allows a return within the ceiling", () => {
    expect(checkReturnQty({ ...base, want: "2", alreadyReturned: "0" })).toBeNull();
    expect(checkReturnQty({ ...base, want: "5", alreadyReturned: "0" })).toBeNull();
  });

  it("refuses more than was issued, and says what is left", () => {
    const err = checkReturnQty({ ...base, want: "6", alreadyReturned: "0" });
    expect(err).toContain("Only 5 kg");
    expect(err).toContain("Onions");
  });

  it("counts a partial prior return against the ceiling", () => {
    // 5 issued, 2 already back — only 3 may still come home.
    expect(checkReturnQty({ ...base, want: "3", alreadyReturned: "2" })).toBeNull();
    const err = checkReturnQty({ ...base, want: "3.001", alreadyReturned: "2" });
    expect(err).toContain("Only 3 kg");
    expect(err).toContain("2 already returned");
  });

  it("says plainly when the issue is already fully returned", () => {
    expect(checkReturnQty({ ...base, want: "1", alreadyReturned: "5" })).toContain(
      "already been returned in full",
    );
  });

  it("refuses a zero or negative quantity", () => {
    expect(checkReturnQty({ ...base, want: "0", alreadyReturned: "0" })).toContain("greater than 0");
    expect(checkReturnQty({ ...base, want: "-1", alreadyReturned: "0" })).toContain("greater than 0");
  });
});

// ─── The chef-declares → store-confirms handover ────────────────────────
//
// Two ceilings, deliberately measuring different things:
//
//   checkDeclareQty  — at the kitchen desk, against INTENT. Counts what is
//                      already declared and waiting, so the chef can't queue
//                      two promises for the same stock.
//   checkReturnQty   — at the counter, against REALITY. Counts CONFIRMED
//                      movements only, because only those have ever touched
//                      on-hand. This is the one standing between a mistyped
//                      quantity and invented stock.
//
// Getting the split backwards is the failure that matters: count pending
// declarations at confirmation and a real handover is refused with the stock
// already on the counter; stop counting confirmed returns and stock can be
// conjured out of nothing.
describe("checkDeclareQty — the ceiling with an unconfirmed declaration in play", () => {
  const base = { issuedQty: "5", name: "Paneer", unit: "kg" };

  it("allows a declaration within what is still out", () => {
    expect(
      checkDeclareQty({ ...base, want: "2", alreadyReturned: "0", alreadyDeclared: "0" }),
    ).toBeNull();
  });

  it("counts a pending declaration against the next one", () => {
    // 5 issued, 4 already declared and waiting on the store → 1 left to
    // promise. Without this the chef could declare 5 twice and the store
    // would be holding a second document it can never fulfil.
    expect(
      checkDeclareQty({ ...base, want: "2", alreadyReturned: "0", alreadyDeclared: "4" }),
    ).toContain("Only 1 kg");
    expect(
      checkDeclareQty({ ...base, want: "1", alreadyReturned: "0", alreadyDeclared: "4" }),
    ).toBeNull();
  });

  it("stacks confirmed returns and pending declarations on the same ceiling", () => {
    // 5 issued, 2 already back, 2 declared → 1 left.
    expect(
      checkDeclareQty({ ...base, want: "1", alreadyReturned: "2", alreadyDeclared: "2" }),
    ).toBeNull();
    expect(
      checkDeclareQty({ ...base, want: "1.5", alreadyReturned: "2", alreadyDeclared: "2" }),
    ).toContain("Only 1 kg");
  });

  it("says the pending part out loud, so the chef knows why they're blocked", () => {
    const msg = checkDeclareQty({
      ...base,
      want: "5",
      alreadyReturned: "0",
      alreadyDeclared: "5",
    });
    expect(msg).toContain("nothing left to send back");
    expect(msg).toContain("5 kg is already declared and waiting on the store");
  });

  it("frees what a declaration was holding once it is rejected", () => {
    // A rejected declaration is no longer DECLARED, so it drops out of
    // alreadyDeclared and the same 5 kg is declarable again. It never moved,
    // so alreadyReturned is untouched by the rejection — nothing to reverse.
    const blocked = checkDeclareQty({
      ...base,
      want: "5",
      alreadyReturned: "0",
      alreadyDeclared: "5",
    });
    const afterRejection = checkDeclareQty({
      ...base,
      want: "5",
      alreadyReturned: "0",
      alreadyDeclared: "0",
    });
    expect(blocked).not.toBeNull();
    expect(afterRejection).toBeNull();
  });

  it("holds exact decimals — a float drift here strands returnable stock", () => {
    expect(
      checkDeclareQty({
        ...base,
        issuedQty: "0.3",
        want: "0.2",
        alreadyReturned: "0",
        alreadyDeclared: "0.1",
      }),
    ).toBeNull();
  });

  it("refuses a zero or negative quantity", () => {
    expect(
      checkDeclareQty({ ...base, want: "0", alreadyReturned: "0", alreadyDeclared: "0" }),
    ).toContain("greater than 0");
    expect(
      checkDeclareQty({ ...base, want: "-1", alreadyReturned: "0", alreadyDeclared: "0" }),
    ).toContain("greater than 0");
  });
});

describe("confirming a declaration — the ceiling measures what MOVED, not what was promised", () => {
  const base = { issuedQty: "5", name: "Paneer", unit: "kg" };
  // The document being confirmed is still DECLARED at the moment of the
  // check, so it is never counted against itself: `alreadyReturned` here is
  // confirmed movements only.

  it("accepts a confirmation BELOW the declared quantity", () => {
    // Chef declared 2 kg, 1.5 kg physically arrived — the case the client is
    // buying this change for.
    expect(checkReturnQty({ ...base, want: "1.5", alreadyReturned: "0" })).toBeNull();
  });

  it("accepts a confirmation EQUAL to the declared quantity", () => {
    expect(checkReturnQty({ ...base, want: "2", alreadyReturned: "0" })).toBeNull();
  });

  it("accepts a confirmation ABOVE the declared quantity while it fits the issue", () => {
    // The chef under-declared and 3 kg turned up against a 5 kg issue. The
    // store books what actually arrived: the declaration is a claim, the
    // issue is the ceiling.
    expect(checkReturnQty({ ...base, want: "3", alreadyReturned: "0" })).toBeNull();
  });

  it("still refuses a confirmation above what the ISSUE can give back", () => {
    // Even 6 kg declared against a 5 kg issue dies here. The safety ceiling
    // is always the issue, never the declaration.
    expect(checkReturnQty({ ...base, want: "6", alreadyReturned: "0" })).toContain("Only 5 kg");
  });

  it("counts an earlier DIRECT return against the confirmation", () => {
    // The hole worth guarding: the store books 4 kg straight in at the
    // counter, then goes to confirm a 2 kg declaration on the same issue.
    // Confirmed movements are 4 of 5, so only 1 can still come back —
    // otherwise 6 kg returns against a 5 kg issue and stock is invented.
    expect(checkReturnQty({ ...base, want: "2", alreadyReturned: "4" })).toContain("Only 1 kg");
    expect(checkReturnQty({ ...base, want: "1", alreadyReturned: "4" })).toBeNull();
  });

  it("does NOT let another pending declaration block a real handover", () => {
    // 5 issued, nothing confirmed, another 5 kg declaration sitting in the
    // queue. That one has moved nothing, so it cannot have consumed
    // anything — the stock physically on the counter still goes back.
    expect(checkReturnQty({ ...base, want: "5", alreadyReturned: "0" })).toBeNull();
  });

  it("refuses once the issue is fully back, whatever was declared", () => {
    expect(checkReturnQty({ ...base, want: "1", alreadyReturned: "5" })).toContain(
      "already been returned in full",
    );
  });
});

describe("itemsStillOutByOrder", () => {
  // Drives the F&B store's return worklist: an order is on the list only
  // while something it was issued has not come back.
  it("counts items, not quantities, and nets per order+item", () => {
    const out = itemsStillOutByOrder(
      [
        { orderId: "o1", itemId: "plate", qty: "100" },
        { orderId: "o1", itemId: "tray", qty: "10" },
        { orderId: "o2", itemId: "plate", qty: "50" },
      ],
      [
        { orderId: "o1", itemId: "plate", qty: "100" }, // fully back
        { orderId: "o1", itemId: "tray", qty: "4" }, // 6 still out
      ],
    );
    expect(out.get("o1")).toBe(1);
    expect(out.get("o2")).toBe(1);
  });

  it("adds up several issues of the same item before netting", () => {
    const out = itemsStillOutByOrder(
      [
        { orderId: "o1", itemId: "cup", qty: "30" },
        { orderId: "o1", itemId: "cup", qty: "20" },
      ],
      [{ orderId: "o1", itemId: "cup", qty: "50" }],
    );
    expect(out.get("o1")).toBe(0);
  });

  it("keeps one order's returns off another order's balance", () => {
    const out = itemsStillOutByOrder(
      [{ orderId: "o1", itemId: "plate", qty: "10" }],
      [{ orderId: "o2", itemId: "plate", qty: "10" }],
    );
    expect(out.get("o1")).toBe(1);
    expect(out.get("o2")).toBe(0);
  });

  it("holds exact decimals — a 0.1 + 0.2 drift would strand an order on the list", () => {
    const out = itemsStillOutByOrder(
      [
        { orderId: "o1", itemId: "foil", qty: "0.1" },
        { orderId: "o1", itemId: "foil", qty: "0.2" },
      ],
      [{ orderId: "o1", itemId: "foil", qty: "0.3" }],
    );
    expect(out.get("o1")).toBe(0);
  });

  it("never counts an over-return as stock still out", () => {
    const out = itemsStillOutByOrder(
      [{ orderId: "o1", itemId: "plate", qty: "5" }],
      [{ orderId: "o1", itemId: "plate", qty: "7" }],
    );
    expect(out.get("o1")).toBe(0);
  });

  it("is empty when nothing ever went out", () => {
    expect(itemsStillOutByOrder([], []).size).toBe(0);
  });
});

describe("weighted average on a return at issue cost", () => {
  it("re-weights on hand at the cost the stock left at, not today's average", () => {
    // 10 kg on hand at ₹20 after a price rise; 5 kg comes back that was
    // issued at ₹10. Value = 10×20 + 5×10 = 250 over 15 kg = ₹16.6667.
    const { qty, avgUnitCost } = newMovingAverage({
      onHandQty: "10",
      avgUnitCost: "20",
      receiptQty: "5",
      receiptUnitCost: "10",
    });
    expect(qty.toString()).toBe("15");
    expect(avgUnitCost.toDecimalPlaces(4).toString()).toBe("16.6667");
    // The value credited to the order is the issue cost, unchanged by the
    // store's current average.
    expect(new Decimal("5").times("10").toString()).toBe("50");
  });

  it("returning into empty stock restores the issue cost exactly", () => {
    const { qty, avgUnitCost } = newMovingAverage({
      onHandQty: "0",
      avgUnitCost: "0",
      receiptQty: "2",
      receiptUnitCost: "37.5",
    });
    expect(qty.toString()).toBe("2");
    expect(avgUnitCost.toString()).toBe("37.5");
  });

  it("issuing then returning the whole lot leaves the average where it started", () => {
    // 12 kg at ₹25. Issue 4 (average untouched), return all 4 at ₹25.
    const afterIssue = { qty: new Decimal("12").minus("4"), avg: new Decimal("25") };
    const back = newMovingAverage({
      onHandQty: afterIssue.qty,
      avgUnitCost: afterIssue.avg,
      receiptQty: "4",
      receiptUnitCost: "25",
    });
    expect(back.qty.toString()).toBe("12");
    expect(back.avgUnitCost.toString()).toBe("25");
  });
});

describe("checkTransferQty", () => {
  const base = { name: "Aluminium Foil", unit: "box" };

  it("allows a transfer the source can cover", () => {
    expect(checkTransferQty({ ...base, want: "1", onHand: "3" })).toBeNull();
    expect(checkTransferQty({ ...base, want: "3", onHand: "3" })).toBeNull();
  });

  it("refuses one that would take the source below zero", () => {
    const err = checkTransferQty({ ...base, want: "4", onHand: "3" });
    expect(err).toContain("Only 3 box");
    expect(err).toContain("Aluminium Foil");
  });

  it("refuses from an empty store", () => {
    expect(checkTransferQty({ ...base, want: "0.5", onHand: "0" })).toContain("Only 0 box");
  });

  it("refuses a zero or negative quantity", () => {
    // Callers blank-guard ("" || "0") before this — decimalString permits "".
    expect(checkTransferQty({ ...base, want: "0", onHand: "3" })).toContain("greater than 0");
    expect(checkTransferQty({ ...base, want: "-2", onHand: "3" })).toContain("greater than 0");
  });
});
