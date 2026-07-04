"use server";

import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { toDecimal } from "@/lib/money";
import { istMonthStart, istMonthEnd, istMonthsInRange } from "@/lib/time";

const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];

interface MonthMetrics {
  revenue: string;
  collected: string;
  invoiceCount: number;
  orderCount: number;
  ingredientIssued: string;
  vendorBills: string;
}

async function monthMetrics(periodStart: Date, periodEnd: Date): Promise<MonthMetrics> {
  // Aggregate in SQL — fetching every invoice/issue/bill row just to sum it
  // in JS made each month cost four table scans of data transfer.
  const [invoiceAgg, orders, issueSum, billAgg] = await Promise.all([
    db.customerInvoice.aggregate({
      where: { issuedAt: { gte: periodStart, lt: periodEnd }, status: { notIn: ["DRAFT", "CANCELLED"] } },
      _sum: { grandTotal: true, amountPaid: true },
      _count: { _all: true },
    }),
    db.order.count({
      where: { createdAt: { gte: periodStart, lt: periodEnd } },
    }),
    // Product of two columns — not expressible with Prisma aggregate.
    db.$queryRaw<Array<{ total: string | null }>>`
      SELECT COALESCE(SUM("qty" * "unitCostAtIssue"), 0)::text AS total
      FROM "IngredientIssue"
      WHERE "issuedAt" >= ${periodStart} AND "issuedAt" < ${periodEnd}`,
    db.vendorBill.aggregate({
      where: { issueDate: { gte: periodStart, lt: periodEnd } },
      _sum: { grandTotal: true },
    }),
  ]);
  return {
    revenue: toDecimal(invoiceAgg._sum.grandTotal ?? "0").toDecimalPlaces(2).toString(),
    collected: toDecimal(invoiceAgg._sum.amountPaid ?? "0").toDecimalPlaces(2).toString(),
    invoiceCount: invoiceAgg._count._all,
    orderCount: orders,
    ingredientIssued: toDecimal(issueSum[0]?.total ?? "0").toDecimalPlaces(2).toString(),
    vendorBills: toDecimal(billAgg._sum.grandTotal ?? "0").toDecimalPlaces(2).toString(),
  };
}

export async function getMonthlyVariance(month: Date) {
  await requireRole(READ_ROLES);
  const thisStart = istMonthStart(month);
  const thisEnd = istMonthEnd(month);
  // istMonthEnd returns end-of-month — use start-of-next-month for lt boundary.
  const thisLt = new Date(thisEnd.getTime() + 1);

  const prevMonth = new Date(thisStart);
  prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
  const prevStart = istMonthStart(prevMonth);
  const prevEnd = istMonthEnd(prevMonth);
  const prevLt = new Date(prevEnd.getTime() + 1);

  const [thisMonth, lastMonth] = await Promise.all([
    monthMetrics(thisStart, thisLt),
    monthMetrics(prevStart, prevLt),
  ]);

  return {
    periodStart: thisStart,
    periodEnd: thisEnd,
    thisMonth,
    lastMonth,
  };
}

export async function getRevenueTrend(months = 12) {
  await requireRole(READ_ROLES);
  const now = new Date();
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - (months - 1));
  const boundaries = istMonthsInRange(from, now);
  // All months in parallel — serially this was months × 4 queries back to
  // back (~48 round-trips), which is what made the reports page crawl.
  const metrics = await Promise.all(
    boundaries.map((start) => {
      const end = istMonthEnd(start);
      const lt = new Date(end.getTime() + 1);
      return monthMetrics(start, lt);
    }),
  );
  return boundaries.map((start, i) => ({
    label: `${start.toLocaleString("en-GB", { month: "short", year: "2-digit" })}`,
    periodStart: start,
    revenue: metrics[i].revenue,
    orderCount: metrics[i].orderCount,
  }));
}
