import { describe, expect, it } from "vitest";
import { ManpowerRequestStatus } from "@prisma/client";
import {
  aggregateManpower,
  isMonthKey,
  monthWindow,
  type ManpowerReportInput,
} from "@/app/(dashboard)/manpower/reports/aggregate";

/**
 * The monthly report is the client's stated reason for the whole feature —
 * "how much manpower was arranged and for which order" — so the roll-up is
 * tested where it can actually be wrong: what counts as arranged, what a
 * part-settled month reports as variance, and the December month boundary.
 */

const S = ManpowerRequestStatus;

function row(over: Partial<ManpowerReportInput> = {}): ManpowerReportInput {
  return {
    status: S.APPROVED,
    orderId: null,
    order: null,
    requestedPeople: 4,
    requestedDays: 2,
    requestedRate: "500",
    ...over,
  };
}

const onOrder = (code: string, id: string, over: Partial<ManpowerReportInput> = {}) =>
  row({ orderId: id, order: { code, customer: { name: `${code} customer` } }, ...over });

describe("what counts as arranged", () => {
  const rows = [
    row({ status: S.APPROVED }),
    row({ status: S.COMPLETED }),
    row({ status: S.PAID }),
    row({ status: S.REQUESTED }),
    row({ status: S.REJECTED }),
    row({ status: S.CANCELLED }),
  ];

  it("counts approved, completed and paid as labour actually arranged", () => {
    expect(aggregateManpower(rows).arranged).toBe(3);
  });

  it("keeps the refused and the called-off visible rather than dropping them", () => {
    const r = aggregateManpower(rows);
    expect(r.raised).toBe(6);
    expect(r.rejected).toBe(1);
    expect(r.cancelled).toBe(1);
  });

  it("leaves a still-pending request out of the money and the people-days", () => {
    // 3 arranged × 4 people × 2 days; the REQUESTED one is not yet arranged.
    expect(aggregateManpower(rows).peopleDays).toBe(24);
    expect(aggregateManpower(rows).estimate.toString()).toBe("12000");
  });
});

describe("people-days and spend follow the approved figures", () => {
  it("costs the manager's edit, not the original ask", () => {
    const r = aggregateManpower([
      row({ approvedPeople: 2, approvedDays: 2, approvedRate: "450" }),
    ]);
    expect(r.peopleDays).toBe(4);
    expect(r.estimate.toString()).toBe("1800");
  });
});

describe("by order", () => {
  const rows = [
    onOrder("ORD-1", "o1"),
    onOrder("ORD-1", "o1", { requestedPeople: 1, requestedDays: 1, requestedRate: "100" }),
    onOrder("ORD-2", "o2"),
    row(),
  ];

  it("groups every arranged request under its order", () => {
    const byOrder = aggregateManpower(rows).byOrder;
    const ord1 = byOrder.find((l) => l.orderId === "o1")!;
    expect(ord1.requests).toBe(2);
    expect(ord1.label).toBe("ORD-1");
    expect(ord1.estimate.toString()).toBe("4100");
  });

  it("gives standalone requests their own line instead of dropping them", () => {
    const standalone = aggregateManpower(rows).byOrder.find((l) => l.orderId === null);
    expect(standalone).toBeDefined();
    expect(standalone!.requests).toBe(1);
    expect(standalone!.key).toBe("");
  });

  it("puts the biggest spend first", () => {
    const byOrder = aggregateManpower(rows).byOrder;
    expect(byOrder.map((l) => l.estimate.toString())).toEqual(["4100", "4000", "4000"]);
  });

  it("adds every order line back up to the month total", () => {
    const r = aggregateManpower(rows);
    const summed = r.byOrder.reduce((n, l) => n.plus(l.estimate), r.byOrder[0].estimate.times(0));
    expect(summed.toString()).toBe(r.estimate.toString());
  });
});

describe("estimate vs actual", () => {
  it("reports no actual at all until something is settled", () => {
    const r = aggregateManpower([row({ status: S.COMPLETED })]);
    expect(r.actual).toBeNull();
    expect(r.variance).toBeNull();
    expect(r.overrun).toBe(false);
  });

  it("flags an overrun against the approved estimate", () => {
    const r = aggregateManpower([row({ status: S.PAID, actualCost: "4500" })]);
    expect(r.actual!.toString()).toBe("4500");
    expect(r.variance!.toString()).toBe("500");
    expect(r.overrun).toBe(true);
  });

  it("does not call an underspend an overrun", () => {
    const r = aggregateManpower([row({ status: S.PAID, actualCost: "3500" })]);
    expect(r.variance!.toString()).toBe("-500");
    expect(r.overrun).toBe(false);
  });

  it("compares a half-settled month against the settled rows only", () => {
    // Two ₹4,000 requests; one settled at ₹4,200, the other not settled at
    // all. The month is ₹200 over on what has been settled — NOT ₹3,800
    // under, which is what comparing against the full ₹8,000 would say.
    const r = aggregateManpower([
      row({ status: S.PAID, actualCost: "4200" }),
      row({ status: S.COMPLETED }),
    ]);
    expect(r.estimate.toString()).toBe("8000");
    expect(r.settled).toBe(1);
    expect(r.variance!.toString()).toBe("200");
    expect(r.overrun).toBe(true);
  });
});

describe("the month window", () => {
  it("is half-open across a normal month", () => {
    const { from, to } = monthWindow("2026-08");
    // IST midnight on the 1st is 18:30 UTC the previous day.
    expect(from.toISOString()).toBe("2026-07-31T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-08-31T18:30:00.000Z");
  });

  it("rolls December over into the next year", () => {
    const { from, to } = monthWindow("2026-12");
    expect(from.toISOString()).toBe("2026-11-30T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });

  it("lands on the 1st for February, where a day-arithmetic window drifts", () => {
    expect(monthWindow("2027-02").to.toISOString()).toBe("2027-02-28T18:30:00.000Z");
  });

  it("accepts only a real YYYY-MM so a hand-typed query can't shift the window", () => {
    expect(isMonthKey("2026-08")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-8")).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
  });
});
