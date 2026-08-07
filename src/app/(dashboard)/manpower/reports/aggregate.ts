import type { Decimal } from "decimal.js";
import { ManpowerRequestStatus } from "@prisma/client";
import { costVariance, effectiveFigures, estimatedCost, type ManpowerCostable } from "@/lib/manpower";
import { sum, zero } from "@/lib/money";
import { istToUtc } from "@/lib/time";

/**
 * The monthly manpower report: how much labour was arranged, what it was
 * estimated to cost, what it actually cost, and — the client's stated
 * purpose — which order each rupee belongs to.
 *
 * Pure arithmetic over rows the caller already fetched, so the month
 * boundaries and the roll-up can both be tested without a database.
 */

/** "Arranged" = a manager said yes. Rejected and cancelled rows are counted
 *  separately: they were asked for, but no labour was ever booked. */
const ARRANGED: ManpowerRequestStatus[] = [
  ManpowerRequestStatus.APPROVED,
  ManpowerRequestStatus.COMPLETED,
  ManpowerRequestStatus.PAID,
];

export interface ManpowerReportInput extends ManpowerCostable {
  status: ManpowerRequestStatus;
  orderId: string | null;
  order: { code: string; customer: { name: string } } | null;
}

export interface ManpowerReportGroup {
  requests: number;
  /** people × days, on the approved figures — the unit the client counts in. */
  peopleDays: number;
  estimate: Decimal;
  /** Sum of settled actuals; null until at least one row is settled. */
  actual: Decimal | null;
  /**
   * actual − the estimate of the SETTLED rows only. Comparing a part-settled
   * month against its whole estimate would read as a huge underspend that
   * nobody underspent.
   */
  variance: Decimal | null;
  overrun: boolean;
  settled: number;
}

export interface ManpowerOrderLine extends ManpowerReportGroup {
  /** orderId, or "" for the standalone line. */
  key: string;
  orderId: string | null;
  label: string;
  customerName: string | null;
}

export interface ManpowerReport extends ManpowerReportGroup {
  raised: number;
  arranged: number;
  rejected: number;
  cancelled: number;
  byOrder: ManpowerOrderLine[];
}

function fold(rows: ManpowerReportInput[]): ManpowerReportGroup {
  const settledRows = rows.filter((r) => costVariance(r).actual !== null);
  const actual = settledRows.length ? sum(settledRows.map((r) => costVariance(r).actual!)) : null;
  const variance = actual === null ? null : actual.minus(sum(settledRows.map((r) => estimatedCost(r))));
  return {
    requests: rows.length,
    peopleDays: rows.reduce((n, r) => {
      const f = effectiveFigures(r);
      return n + f.people * f.days;
    }, 0),
    estimate: rows.length ? sum(rows.map((r) => estimatedCost(r))) : zero(),
    actual,
    variance,
    overrun: variance !== null && variance.gt(0),
    settled: settledRows.length,
  };
}

export function aggregateManpower(rows: ManpowerReportInput[]): ManpowerReport {
  const arranged = rows.filter((r) => ARRANGED.includes(r.status));

  // Standalone requests get their own line rather than being dropped — a
  // month's spend that isn't against any order still happened.
  const groups = new Map<string, ManpowerReportInput[]>();
  for (const r of arranged) {
    const key = r.orderId ?? "";
    const existing = groups.get(key);
    if (existing) existing.push(r);
    else groups.set(key, [r]);
  }

  const byOrder = [...groups.entries()]
    .map(([key, list]) => ({
      key,
      orderId: list[0].orderId,
      label: list[0].order?.code ?? "No order — standalone",
      customerName: list[0].order?.customer.name ?? null,
      ...fold(list),
    }))
    .sort((a, b) => b.estimate.comparedTo(a.estimate));

  return {
    ...fold(arranged),
    raised: rows.length,
    arranged: arranged.length,
    rejected: rows.filter((r) => r.status === ManpowerRequestStatus.REJECTED).length,
    cancelled: rows.filter((r) => r.status === ManpowerRequestStatus.CANCELLED).length,
    byOrder,
  };
}

/**
 * Half-open [from, to) UTC window for the IST calendar month given as
 * "YYYY-MM". Built by incrementing the month string, not by adding days or
 * months to a Date — a 28/31-day rollover drifts across the IST offset and
 * silently reports the wrong month.
 */
export function monthWindow(month: string): { from: Date; to: Date } {
  const [year, m] = month.split("-").map(Number);
  const nextYear = m === 12 ? year + 1 : year;
  const nextMonth = m === 12 ? 1 : m + 1;
  return {
    from: istToUtc(`${month}-01T00:00:00`),
    to: istToUtc(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00`),
  };
}

/** A "YYYY-MM" the <input type="month"> and monthWindow both accept. */
export function isMonthKey(value: string | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
