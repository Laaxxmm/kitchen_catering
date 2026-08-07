import { describe, expect, it } from "vitest";
import { ManpowerRequestStatus } from "@prisma/client";
import {
  MANPOWER_TRANSITIONS,
  canTransition,
  costVariance,
  effectiveFigures,
  estimatedCost,
  isPayable,
  manpowerCost,
  payRefusal,
  requestedCost,
  requestedFigures,
  settleRefusal,
  transitionRefusal,
  wasEditedAtApproval,
} from "@/lib/manpower";

// Real wages leave the building on these decisions, so the transition table
// is asserted exhaustively — a new status must not quietly become payable,
// and no illegal move may open up by accident.

const ALL = Object.values(ManpowerRequestStatus);
const S = ManpowerRequestStatus;

describe("lifecycle transitions", () => {
  it("allows exactly the documented moves out of each status", () => {
    expect(MANPOWER_TRANSITIONS[S.REQUESTED]).toEqual([S.APPROVED, S.REJECTED, S.CANCELLED]);
    expect(MANPOWER_TRANSITIONS[S.APPROVED]).toEqual([S.COMPLETED, S.CANCELLED]);
    expect(MANPOWER_TRANSITIONS[S.COMPLETED]).toEqual([S.PAID]);
    expect(MANPOWER_TRANSITIONS[S.PAID]).toEqual([]);
    expect(MANPOWER_TRANSITIONS[S.REJECTED]).toEqual([]);
    expect(MANPOWER_TRANSITIONS[S.CANCELLED]).toEqual([]);
  });

  it("refuses every from/to pair the table doesn't list", () => {
    const legal: Array<[ManpowerRequestStatus, ManpowerRequestStatus]> = [];
    for (const from of ALL) {
      for (const to of ALL) {
        if (canTransition(from, to)) legal.push([from, to]);
      }
    }
    expect(legal).toEqual([
      [S.REQUESTED, S.APPROVED],
      [S.REQUESTED, S.REJECTED],
      [S.REQUESTED, S.CANCELLED],
      [S.APPROVED, S.COMPLETED],
      [S.APPROVED, S.CANCELLED],
      [S.COMPLETED, S.PAID],
    ]);
  });

  it("never lets a status transition to itself", () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
  });

  it("never re-opens a terminal status", () => {
    for (const terminal of [S.PAID, S.REJECTED, S.CANCELLED]) {
      for (const to of ALL) expect(canTransition(terminal, to)).toBe(false);
    }
  });

  it("never approves anything that isn't still requested", () => {
    const approvable = ALL.filter((from) => canTransition(from, S.APPROVED));
    expect(approvable).toEqual([S.REQUESTED]);
  });

  it("never completes anything that wasn't approved", () => {
    const completable = ALL.filter((from) => canTransition(from, S.COMPLETED));
    expect(completable).toEqual([S.APPROVED]);
  });

  it("cannot cancel a job that has already been done", () => {
    // The labour worked — cancelling would silently strand their wages.
    expect(canTransition(S.COMPLETED, S.CANCELLED)).toBe(false);
    expect(transitionRefusal(S.COMPLETED, S.CANCELLED)).toContain("can't be marked cancelled");
  });
});

describe("transition refusals", () => {
  it("says nothing when the move is legal", () => {
    expect(transitionRefusal(S.REQUESTED, S.APPROVED)).toBeNull();
    expect(transitionRefusal(S.COMPLETED, S.PAID)).toBeNull();
  });

  it("names the already-there case plainly", () => {
    expect(transitionRefusal(S.APPROVED, S.APPROVED)).toBe("This request is already approved.");
  });

  it("tells a terminal request it is finished", () => {
    expect(transitionRefusal(S.PAID, S.COMPLETED)).toContain("nothing more can be done");
    expect(transitionRefusal(S.CANCELLED, S.APPROVED)).toContain("nothing more can be done");
  });

  it("humanises both statuses in the message", () => {
    expect(transitionRefusal(S.REQUESTED, S.PAID)).toBe(
      "A requested request can't be marked paid.",
    );
  });
});

describe("payment gate", () => {
  const settled = "4500.00";

  it("pays only a completed request", () => {
    const payable = ALL.filter(isPayable);
    expect(payable).toEqual([S.COMPLETED]);
  });

  it("refuses payment before anyone approved it", () => {
    // The stale-tab case: the button is hidden, the request still arrives.
    expect(payRefusal(S.REQUESTED, settled)).toContain("Nobody has approved");
  });

  it("refuses payment after approval but before the job is done", () => {
    expect(payRefusal(S.APPROVED, settled)).toContain("isn't marked done");
  });

  it("refuses payment on a rejected or cancelled request", () => {
    expect(payRefusal(S.REJECTED, settled)).toContain("only an approved, completed request");
    expect(payRefusal(S.CANCELLED, settled)).toContain("only an approved, completed request");
  });

  it("refuses paying twice", () => {
    expect(payRefusal(S.PAID, settled)).toContain("already paid");
  });

  it("refuses payment until accounts have settled a figure", () => {
    expect(payRefusal(S.COMPLETED, null)).toContain("Record the actual cost");
    // decimalString lets "" through; a blank box must not read as ₹0 paid.
    expect(payRefusal(S.COMPLETED, "")).toContain("Record the actual cost");
    expect(payRefusal(S.COMPLETED, "   ")).toContain("Record the actual cost");
  });

  it("allows an approved, completed, settled request", () => {
    expect(payRefusal(S.COMPLETED, settled)).toBeNull();
    expect(payRefusal(S.COMPLETED, "0")).toBeNull();
  });
});

describe("settling the actual cost", () => {
  it("only allows it once the job is done", () => {
    const settleable = ALL.filter((s) => settleRefusal(s) === null);
    expect(settleable).toEqual([S.COMPLETED]);
  });

  it("freezes the figure after payment", () => {
    expect(settleRefusal(S.PAID)).toContain("already paid");
  });

  it("tells an approved-but-unfinished request to finish the job first", () => {
    expect(settleRefusal(S.APPROVED)).toContain("mark the job done");
  });
});

describe("cost arithmetic", () => {
  it("multiplies people × days × rate in Decimal", () => {
    expect(manpowerCost(6, 2, "500").toFixed(2)).toBe("6000.00");
  });

  it("keeps paise exact where floats would not", () => {
    // 3 × 3 × 0.1 is 0.8999999999999999 in float arithmetic.
    expect(manpowerCost(3, 3, "0.1").toFixed(2)).toBe("0.90");
    expect(manpowerCost(1, 1, "1450.55").toFixed(2)).toBe("1450.55");
  });

  it("rounds half-up to paise", () => {
    expect(manpowerCost(3, 1, "33.335").toFixed(2)).toBe("100.01");
  });

  it("reads a blank rate as nothing costed, never a DecimalError", () => {
    // decimalString permits ""; new Decimal("") throws. This app has
    // shipped that crash twice.
    expect(() => manpowerCost(6, 2, "")).not.toThrow();
    expect(manpowerCost(6, 2, "").toFixed(2)).toBe("0.00");
    expect(manpowerCost(6, 2, "   ").toFixed(2)).toBe("0.00");
    expect(manpowerCost(6, 2, null).toFixed(2)).toBe("0.00");
    expect(manpowerCost(6, 2, undefined).toFixed(2)).toBe("0.00");
  });

  it("reads a missing count as nothing costed", () => {
    expect(manpowerCost(null, 2, "500").toFixed(2)).toBe("0.00");
    expect(manpowerCost(6, null, "500").toFixed(2)).toBe("0.00");
    expect(manpowerCost(Number.NaN, 2, "500").toFixed(2)).toBe("0.00");
  });

  it("costs a zero rate as zero without complaint", () => {
    expect(manpowerCost(6, 2, "0").toFixed(2)).toBe("0.00");
  });
});

describe("the original request survives the manager's edit", () => {
  // "Asked for 6 at ₹500, approved 4 at ₹450" — the whole point of the
  // separate approved* columns.
  const edited = {
    requestedPeople: 6,
    requestedDays: 2,
    requestedRate: "500",
    approvedPeople: 4,
    approvedDays: 2,
    approvedRate: "450",
  };

  it("still reports what was asked for", () => {
    expect(requestedFigures(edited)).toEqual({ people: 6, days: 2, rate: "500" });
    expect(requestedCost(edited).toFixed(2)).toBe("6000.00");
  });

  it("costs the money on the approved figures", () => {
    expect(effectiveFigures(edited)).toEqual({ people: 4, days: 2, rate: "450" });
    expect(estimatedCost(edited).toFixed(2)).toBe("3600.00");
  });

  it("flags that the manager changed the numbers", () => {
    expect(wasEditedAtApproval(edited)).toBe(true);
  });

  it("falls back to the requested figures before approval", () => {
    const pending = { requestedPeople: 6, requestedDays: 2, requestedRate: "500" };
    expect(effectiveFigures(pending)).toEqual({ people: 6, days: 2, rate: "500" });
    expect(estimatedCost(pending).toFixed(2)).toBe("6000.00");
    expect(wasEditedAtApproval(pending)).toBe(false);
  });

  it("does not call an unchanged approval an edit, whatever the rate's spelling", () => {
    const unchanged = {
      requestedPeople: 6,
      requestedDays: 2,
      requestedRate: "500",
      approvedPeople: 6,
      approvedDays: 2,
      approvedRate: "500.00", // how Postgres hands a DECIMAL(12,2) back
    };
    expect(wasEditedAtApproval(unchanged)).toBe(false);
  });
});

describe("estimate vs actual", () => {
  const approved = {
    requestedPeople: 6,
    requestedDays: 2,
    requestedRate: "500",
    approvedPeople: 4,
    approvedDays: 2,
    approvedRate: "450",
  };

  it("reports nothing settled yet rather than a fake zero overrun", () => {
    const v = costVariance(approved);
    expect(v.estimate.toFixed(2)).toBe("3600.00");
    expect(v.actual).toBeNull();
    expect(v.variance).toBeNull();
    expect(v.overrun).toBe(false);
  });

  it("treats a blank actual cost as not settled, never a DecimalError", () => {
    expect(() => costVariance({ ...approved, actualCost: "" })).not.toThrow();
    expect(costVariance({ ...approved, actualCost: "" }).actual).toBeNull();
  });

  it("reports an underspend as a negative variance", () => {
    const v = costVariance({ ...approved, actualCost: "3200" });
    expect(v.variance?.toFixed(2)).toBe("-400.00");
    expect(v.overrun).toBe(false);
  });

  it("reports an overrun when the actual exceeds the estimate", () => {
    const v = costVariance({ ...approved, actualCost: "4100.50" });
    expect(v.actual?.toFixed(2)).toBe("4100.50");
    expect(v.variance?.toFixed(2)).toBe("500.50");
    expect(v.overrun).toBe(true);
  });

  it("is not an overrun when it lands exactly on the estimate", () => {
    const v = costVariance({ ...approved, actualCost: "3600.00" });
    expect(v.variance?.toFixed(2)).toBe("0.00");
    expect(v.overrun).toBe(false);
  });

  it("measures against the approved figures, not the original ask", () => {
    // Settled at ₹3,900: under what was asked for, over what was approved.
    const v = costVariance({ ...approved, actualCost: "3900" });
    expect(v.overrun).toBe(true);
    expect(v.variance?.toFixed(2)).toBe("300.00");
  });
});
