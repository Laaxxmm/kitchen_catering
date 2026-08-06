import { describe, expect, it } from "vitest";
import { ChefRequisitionLineStatus } from "@prisma/client";
import { decideAmend } from "@/app/(dashboard)/requisitions/[id]/_components/amend-rules";

/**
 * The chef raises a requisition line after the store has already issued
 * against it (order revised 10 pax → 20). Everything downstream — whether the
 * shortfall goes back on the store's queue, whether the requisition re-opens —
 * hangs off the status this returns, so every rung of the ladder is tested,
 * and from both sides of the issuedQty boundary.
 */
const S = ChefRequisitionLineStatus;

function amend(
  current: string,
  next: string,
  issued: string,
  // Explicitly the enum, not the inferred literal type of the default — else
  // every call passing another status fails to typecheck.
  status: ChefRequisitionLineStatus = S.PENDING,
) {
  return decideAmend({ currentQty: current, newQty: next, issuedQty: issued, lineStatus: status });
}

describe("decideAmend — resulting line status", () => {
  it("drops a fully-issued line back to PARTIALLY_ISSUED when raised", () => {
    // The whole feature: 5 already handed over, chef now needs 10, so the
    // store owes 5 and the line must leave the ISSUED state to show it.
    const d = amend("5", "10", "5", S.ISSUED);
    expect(d).toEqual({ ok: true, qty: "10", status: S.PARTIALLY_ISSUED });
  });

  it("leaves an untouched line PENDING when raised", () => {
    expect(amend("5", "10", "0", S.PENDING)).toEqual({ ok: true, qty: "10", status: S.PENDING });
  });

  it("keeps a part-issued line PARTIALLY_ISSUED when raised", () => {
    expect(amend("10", "15", "4", S.PARTIALLY_ISSUED)).toEqual({
      ok: true,
      qty: "15",
      status: S.PARTIALLY_ISSUED,
    });
  });

  it("closes the line as ISSUED when lowered to exactly the issued qty", () => {
    expect(amend("10", "4", "4", S.PARTIALLY_ISSUED)).toEqual({
      ok: true,
      qty: "4",
      status: S.ISSUED,
    });
  });

  it("holds AWAITING_PROCUREMENT — a PO is out and the GRN owns that flag", () => {
    expect(amend("5", "12", "0", S.AWAITING_PROCUREMENT)).toEqual({
      ok: true,
      qty: "12",
      status: S.AWAITING_PROCUREMENT,
    });
  });
});

describe("decideAmend — what it refuses", () => {
  it("refuses to go below what has already been issued", () => {
    const d = amend("10", "4.999", "5", S.PARTIALLY_ISSUED);
    expect(d.ok).toBe(false);
    // The message has to name the issued amount — the chef's next move is a
    // physical return, not another edit.
    if (!d.ok) expect(d.error).toContain("5");
  });

  it("refuses an unchanged quantity, trailing zeros and all", () => {
    expect(amend("5", "5", "0").ok).toBe(false);
    expect(amend("5.000", "5", "0").ok).toBe(false);
    // 5.0004 rounds to the stored 5.000 — still a no-op, not an amend.
    expect(amend("5.000", "5.0004", "0").ok).toBe(false);
  });

  it("refuses zero, negative and garbage", () => {
    expect(amend("5", "0", "0").ok).toBe(false);
    expect(amend("5", "-3", "0").ok).toBe(false);
    expect(amend("5", "", "0").ok).toBe(false);
    expect(amend("5", "abc", "0").ok).toBe(false);
  });

  it("refuses a cancelled line", () => {
    expect(amend("5", "10", "0", S.CANCELLED).ok).toBe(false);
  });
});

describe("decideAmend — decimal quantities", () => {
  it("compares in decimal, not binary float", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in JS. Requesting 0.3 against 0.3
    // issued must read as fully issued, not 0.3 short of itself.
    expect(amend("0.5", "0.3", "0.3", S.PARTIALLY_ISSUED)).toEqual({
      ok: true,
      qty: "0.3",
      status: S.ISSUED,
    });
    // …and one thousandth below it is a genuine un-issue attempt.
    expect(amend("0.5", "0.299", "0.3", S.PARTIALLY_ISSUED).ok).toBe(false);
  });

  it("stores at the column's 3 decimal places", () => {
    const d = amend("1", "2.5006", "0");
    expect(d.ok && d.qty).toBe("2.501");
  });
});
