import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { checkReturnQty, checkTransferQty, remainingReturnable } from "@/lib/stock-movement";
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
