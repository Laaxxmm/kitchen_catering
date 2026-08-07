import "./database";
import { beforeAll, describe, expect, it } from "vitest";
import { ManpowerRequestStatus, PaymentMethod } from "@prisma/client";
import { db } from "@/server/db";
import {
  approveManpowerRequest,
  cancelManpowerRequest,
  completeManpowerRequest,
  createManpowerRequest,
  listManpowerRequestsInWindow,
  payManpowerRequest,
  rejectManpowerRequest,
  settleManpowerCost,
} from "@/server/actions/manpower";
import {
  aggregateManpower,
  isMonthKey,
  monthWindow,
  type ManpowerReport,
} from "@/app/(dashboard)/manpower/reports/aggregate";
import { formatIST, istToUtc } from "@/lib/time";
import {
  asAccounts,
  asChef,
  asManager,
  asNobody,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  mustOk,
  placeCateringOrder,
  read,
} from "../harness";

/**
 * The monthly report — "recorded and generated as a report each month so we
 * can see how much manpower was arranged and for which order".
 *
 * A month with six requests against two orders and one standalone: some
 * approved, one turned down, one called off, some settled above estimate and
 * some below. The two ways this report can lie are both asserted directly:
 *
 *   - dropping the standalone requests, so a month's spend that belongs to
 *     no order simply vanishes;
 *   - comparing the settled actuals against the estimate of EVERY arranged
 *     request, which makes a half-settled month read as a huge underspend.
 */

const MONTH = formatIST(new Date(), "yyyy-MM");

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Park a request on a given day of a month. `createdAt` is `@default(now())`
 * with no way in through the actions, and the report windows on it — so the
 * clock is moved directly. Nothing else about the row is touched: every
 * status, figure and rupee on it got there through the real actions.
 */
async function dateRequest(id: string, month: string, day: number): Promise<void> {
  await db.manpowerRequest.update({
    where: { id },
    data: { createdAt: istToUtc(`${month}-${String(day).padStart(2, "0")}T12:00:00`) },
  });
}

/** Raise → approve (optionally editing) → complete → settle → pay, as far
 *  as the caller asks for. Every step is the real action on the real desk. */
async function lifecycle(opts: {
  orderId: string | null;
  workDescription: string;
  asked: { people: number; days: number; rate: string };
  approved?: { people: number; days: number; rate: string };
  stopAt?: "requested" | "approved" | "completed" | "settled" | "paid";
  actualCost?: string;
  outcome?: "rejected" | "cancelled";
  month?: string;
  day: number;
}): Promise<string> {
  asChef();
  const { id } = mustOk(
    await createManpowerRequest({
      orderId: opts.orderId,
      workDescription: opts.workDescription,
      people: opts.asked.people,
      days: opts.asked.days,
      ratePerPersonPerDay: opts.asked.rate,
    }),
    `raise ${opts.workDescription}`,
  );
  await dateRequest(id, opts.month ?? MONTH, opts.day);

  if (opts.outcome === "rejected") {
    asManager();
    mustOk(await rejectManpowerRequest(id, "Not in this month's budget."), "reject");
    return id;
  }
  if (opts.outcome === "cancelled") {
    asChef();
    mustOk(await cancelManpowerRequest(id), "cancel");
    return id;
  }

  const stop = opts.stopAt ?? "paid";
  if (stop === "requested") return id;

  asManager();
  mustOk(
    await approveManpowerRequest({
      id,
      ...(opts.approved
        ? {
            people: opts.approved.people,
            days: opts.approved.days,
            ratePerPersonPerDay: opts.approved.rate,
          }
        : {}),
    }),
    `approve ${opts.workDescription}`,
  );
  if (stop === "approved") return id;

  asChef();
  mustOk(await completeManpowerRequest(id), `complete ${opts.workDescription}`);
  if (stop === "completed") return id;

  asAccounts();
  mustOk(
    await settleManpowerCost({ id, actualCost: opts.actualCost! }),
    `settle ${opts.workDescription}`,
  );
  if (stop === "settled") return id;

  mustOk(await payManpowerRequest({ id, method: PaymentMethod.NEFT }), `pay ${opts.workDescription}`);
  return id;
}

let orderA: string;
let orderB: string;
let report: ManpowerReport;

beforeAll(async () => {
  await ensureSeeded();
  orderA = (await placeCateringOrder()).id;
  orderB = (await placeCateringOrder({ headcount: 60 })).id;

  // ── Order A ────────────────────────────────────────────────────────────
  // Asked 6 × 2 @ ₹500 (₹6,000) → approved 4 × 2 @ ₹450 (₹3,600) → the
  // labour invoiced ₹3,900. Settled and paid: a ₹300 overrun.
  await lifecycle({
    orderId: orderA,
    workDescription: "Serving crew — Reddy wedding",
    asked: { people: 6, days: 2, rate: "500" },
    approved: { people: 4, days: 2, rate: "450" },
    actualCost: "3900",
    day: 2,
  });
  // Approved as asked (₹1,600), job done, nobody has settled it yet. This is
  // the row that turns the month half-settled.
  await lifecycle({
    orderId: orderA,
    workDescription: "Pot wash — Reddy wedding",
    asked: { people: 2, days: 1, rate: "800" },
    stopAt: "completed",
    day: 5,
  });

  // ── Order B ────────────────────────────────────────────────────────────
  // Asked 5 × 1 @ ₹400 (₹2,000) → approved at ₹300 (₹1,500) → came in at
  // ₹1,200: ₹300 under.
  await lifecycle({
    orderId: orderB,
    workDescription: "Setup crew — corporate lunch",
    asked: { people: 5, days: 1, rate: "400" },
    approved: { people: 5, days: 1, rate: "300" },
    actualCost: "1200",
    stopAt: "settled",
    day: 8,
  });

  // ── Standalone — no order behind it ────────────────────────────────────
  // ₹1,800 approved, ₹2,000 settled: ₹200 over.
  await lifecycle({
    orderId: null,
    workDescription: "Deep clean of the banquet hall",
    asked: { people: 3, days: 1, rate: "600" },
    actualCost: "2000",
    stopAt: "settled",
    day: 9,
  });

  // ── Asked for but never arranged ───────────────────────────────────────
  await lifecycle({
    orderId: orderB,
    workDescription: "Second bar crew",
    asked: { people: 10, days: 3, rate: "700" },
    outcome: "rejected",
    day: 11,
  });
  await lifecycle({
    orderId: null,
    workDescription: "Cloakroom cover",
    asked: { people: 1, days: 1, rate: "100" },
    outcome: "cancelled",
    day: 12,
  });

  // ── Last month — must not leak into this month's figures ───────────────
  await lifecycle({
    orderId: orderA,
    workDescription: "Last month's crew",
    asked: { people: 4, days: 1, rate: "1000" },
    actualCost: "4000",
    month: previousMonth(MONTH),
    day: 20,
  });

  const { from, to } = monthWindow(MONTH);
  asManager();
  report = aggregateManpower(await listManpowerRequestsInWindow(from, to));
});

describe("the month window", () => {
  it("accepts a YYYY-MM and rejects anything else", () => {
    expect(isMonthKey(MONTH)).toBe(true);
    for (const bad of [undefined, "", "2026-13", "2026-00", "2026-1", "not-a-month"]) {
      expect(isMonthKey(bad)).toBe(false);
    }
  });

  it("is half-open — the next month's first instant is out", () => {
    const { from, to } = monthWindow(MONTH);
    expect(from.getTime()).toBeLessThan(to.getTime());
    expect(from).toEqual(istToUtc(`${MONTH}-01T00:00:00`));
    // IST is UTC+5:30, so the IST month starts at 18:30 UTC the day before.
    expect(from.getUTCHours()).toBe(18);
    expect(from.getUTCMinutes()).toBe(30);
  });

  it("leaves last month's request out of this month", () => {
    expect(report.raised).toBe(6);
    const labels = report.byOrder.flatMap((l) => l.label);
    expect(labels).not.toContain("Last month's crew");
  });

  it("finds it when the report asks for last month instead", async () => {
    const { from, to } = monthWindow(previousMonth(MONTH));
    asManager();
    const last = aggregateManpower(await listManpowerRequestsInWindow(from, to));
    expect(last.raised).toBe(1);
    expect(last.arranged).toBe(1);
    expectDecimal(last.estimate, "4000", "last month's estimate");
    expectDecimal(last.actual, "4000", "last month's actual");
  });

  it("is a signed-out user's business no more than anyone else's data is", async () => {
    const { from, to } = monthWindow(MONTH);
    asNobody();
    await expectRefused(() => listManpowerRequestsInWindow(from, to));
  });
});

describe("what was arranged, and what was only asked for", () => {
  it("counts the six raised, four arranged, one turned down, one called off", () => {
    expect(report.raised).toBe(6);
    expect(report.arranged).toBe(4);
    expect(report.rejected).toBe(1);
    expect(report.cancelled).toBe(1);
  });

  it("counts people-days on the APPROVED figures, not what was asked", () => {
    // 4×2 + 2×1 + 5×1 + 3×1 = 18. On the asked-for figures it would be
    // 6×2 + 2×1 + 5×1 + 3×1 = 22 — the manager's edit has to count.
    expect(report.peopleDays).toBe(18);
  });

  it("estimates the month on the approved figures of the arranged rows", () => {
    // 3600 + 1600 + 1500 + 1800. The rejected 10×3@700 (₹21,000) and the
    // cancelled ₹100 are not spend, and must not appear here.
    expectDecimal(report.estimate, "8500", "month estimate");
  });
});

describe("variance is measured against the settled rows only", () => {
  it("adds up what was actually settled", () => {
    // 3900 (order A) + 1200 (order B) + 2000 (standalone). The ₹1,600
    // pot-wash job is done but uncosted, so it is in neither figure.
    expectDecimal(report.actual, "7100", "month actual");
    expect(report.settled).toBe(3);
    expect(report.arranged).toBe(4);
  });

  it("compares it against the estimate of those three rows, not all four", () => {
    // Settled estimates: 3600 + 1500 + 1800 = 6900. Actual 7100 → +200 over.
    expectDecimal(report.variance, "200", "month variance");
    expect(report.overrun).toBe(true);
  });

  it("does not read a half-settled month as a ₹1,400 underspend", () => {
    // 7100 − 8500 = −1400 is what comparing against the whole month's
    // estimate would produce. Nobody underspent by ₹1,400.
    expect(Number(report.variance!.toString())).not.toBe(-1400);
    expect(Number(report.variance!.toString())).toBeGreaterThan(0);
  });

  it("shows nothing rather than a fake zero when a month has no settlements", () => {
    const unsettled = aggregateManpower([
      {
        status: ManpowerRequestStatus.APPROVED,
        orderId: null,
        order: null,
        requestedPeople: 2,
        requestedDays: 1,
        requestedRate: "500",
        approvedPeople: 2,
        approvedDays: 1,
        approvedRate: "500",
        actualCost: null,
      },
    ]);
    expect(unsettled.actual).toBeNull();
    expect(unsettled.variance).toBeNull();
    expect(unsettled.overrun).toBe(false);
    expectDecimal(unsettled.estimate, "1000", "estimate with nothing settled");
  });

  it("does not count a still-pending ask as arranged spend", () => {
    // Raised but not yet approved. Nobody has committed to it, so it belongs
    // in "raised" and nowhere else — not in the estimate, not in people-days,
    // and not on any order's line.
    const pending = aggregateManpower([
      {
        status: ManpowerRequestStatus.REQUESTED,
        orderId: "order-x",
        order: { code: "ORD-X", customer: { name: "Someone" } },
        requestedPeople: 20,
        requestedDays: 5,
        requestedRate: "900",
        approvedPeople: null,
        approvedDays: null,
        approvedRate: null,
        actualCost: null,
      },
    ]);
    expect(pending.raised).toBe(1);
    expect(pending.arranged).toBe(0);
    expect(pending.peopleDays).toBe(0);
    expectDecimal(pending.estimate, "0", "estimate with nothing arranged");
    expect(pending.byOrder).toEqual([]);
  });

  it("treats a blank settled cost as unsettled, not as ₹0", () => {
    // decimalString lets "" through and new Decimal("") throws; a blank box
    // must read as "nobody has costed this", never as a free job.
    const blank = aggregateManpower([
      {
        status: ManpowerRequestStatus.COMPLETED,
        orderId: null,
        order: null,
        requestedPeople: 2,
        requestedDays: 1,
        requestedRate: "500",
        approvedPeople: 2,
        approvedDays: 1,
        approvedRate: "500",
        actualCost: "",
      },
    ]);
    expect(blank.actual).toBeNull();
    expect(blank.variance).toBeNull();
  });
});

describe("the per-order breakdown", () => {
  function line(key: string) {
    const found = report.byOrder.find((l) => l.key === key);
    expect(found, `no report line for ${key || "(standalone)"}`).toBeDefined();
    return found!;
  }

  it("gives each order its own line, biggest estimate first", () => {
    expect(report.byOrder.map((l) => l.key)).toEqual([orderA, "", orderB]);
  });

  it("rolls order A's two requests into one line with its one settlement", async () => {
    const a = line(orderA);
    expect(a.orderId).toBe(orderA);
    expect(a.label).toBe((await read.order(orderA)).code);
    expect(a.customerName).toBe("E2E Catering Client");
    expect(a.requests).toBe(2);
    expect(a.peopleDays).toBe(4 * 2 + 2 * 1);
    expectDecimal(a.estimate, "5200", "order A estimate");
    expect(a.settled).toBe(1);
    expectDecimal(a.actual, "3900", "order A actual");
    // Against the settled row's own ₹3,600 estimate — not the line's ₹5,200.
    expectDecimal(a.variance, "300", "order A variance");
    expect(a.overrun).toBe(true);
  });

  it("shows order B under its estimate", () => {
    const b = line(orderB);
    expect(b.requests).toBe(1);
    expectDecimal(b.estimate, "1500", "order B estimate");
    expectDecimal(b.actual, "1200", "order B actual");
    expectDecimal(b.variance, "-300", "order B variance");
    expect(b.overrun).toBe(false);
  });

  it("gives the standalone request its own line rather than dropping it", () => {
    const standalone = line("");
    expect(standalone.orderId).toBeNull();
    expect(standalone.label).toBe("No order — standalone");
    expect(standalone.customerName).toBeNull();
    expect(standalone.requests).toBe(1);
    expectDecimal(standalone.estimate, "1800", "standalone estimate");
    expectDecimal(standalone.actual, "2000", "standalone actual");
    expectDecimal(standalone.variance, "200", "standalone variance");
  });

  it("adds up to the month, so nothing was dropped on the way", () => {
    const totalEstimate = report.byOrder.reduce(
      (n, l) => n + Number(l.estimate.toString()),
      0,
    );
    const totalRequests = report.byOrder.reduce((n, l) => n + l.requests, 0);
    expect(totalRequests).toBe(report.arranged);
    expect(totalEstimate).toBe(Number(report.estimate.toString()));
  });

  it("leaves the rejected and cancelled asks off the breakdown entirely", () => {
    expect(report.byOrder.map((l) => l.requests).reduce((a, b) => a + b, 0)).toBe(4);
    // The rejected 10 × 3 @ ₹700 was against order B; B's line is the single
    // ₹1,500 setup crew, so ₹21,000 never entered the arithmetic.
    expectDecimal(report.byOrder.find((l) => l.key === orderB)!.estimate, "1500", "order B line");
  });
});

describe("the month boundary itself", () => {
  /**
   * Runs last on purpose: it adds two more rows, one on each side of the
   * midnight the window is cut at, and re-queries rather than reusing the
   * report the other describes assert on.
   */
  let boundary: ManpowerReport;
  let nextMonthReport: ManpowerReport;

  beforeAll(async () => {
    const first = await lifecycle({
      orderId: null,
      workDescription: "First instant of the month",
      asked: { people: 1, days: 1, rate: "100" },
      stopAt: "approved",
      day: 1,
    });
    // The very first second of the IST month — inclusive edge.
    await db.manpowerRequest.update({
      where: { id: first },
      data: { createdAt: istToUtc(`${MONTH}-01T00:00:00`) },
    });

    const next = await lifecycle({
      orderId: null,
      workDescription: "First instant of the NEXT month",
      asked: { people: 1, days: 1, rate: "100" },
      stopAt: "approved",
      day: 1,
    });
    // The exclusive edge: `to` itself must fall outside the window.
    const { to } = monthWindow(MONTH);
    await db.manpowerRequest.update({ where: { id: next }, data: { createdAt: to } });

    const { from } = monthWindow(MONTH);
    asManager();
    boundary = aggregateManpower(await listManpowerRequestsInWindow(from, to));
    // `to` IS the next IST month's first instant, so it names that month.
    const after = monthWindow(formatIST(to, "yyyy-MM"));
    nextMonthReport = aggregateManpower(await listManpowerRequestsInWindow(after.from, after.to));
  });

  it("takes the first instant of the month in", () => {
    // 6 from the main scenario + the one sitting exactly on `from`.
    expect(boundary.raised).toBe(7);
  });

  it("leaves the first instant of the next month out", () => {
    expect(boundary.raised).toBe(7);
    expect(nextMonthReport.raised).toBe(1);
  });
});

describe("neither order moved through any of it", () => {
  it("left both orders where the kitchen left them", async () => {
    for (const id of [orderA, orderB]) {
      // placeCateringOrder submits; nothing here should have advanced it.
      expect(await read.orderStatus(id)).toBe("PENDING_CHEF_APPROVAL");
    }
  });
});
