"use server";

import { Decimal } from "decimal.js";
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
  const [invoices, orders, issues, bills] = await Promise.all([
    db.customerInvoice.findMany({
      where: { issuedAt: { gte: periodStart, lt: periodEnd }, status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: { grandTotal: true, amountPaid: true },
    }),
    db.order.count({
      where: { createdAt: { gte: periodStart, lt: periodEnd } },
    }),
    db.ingredientIssue.findMany({
      where: { issuedAt: { gte: periodStart, lt: periodEnd } },
      select: { qty: true, unitCostAtIssue: true },
    }),
    db.vendorBill.findMany({
      where: { issueDate: { gte: periodStart, lt: periodEnd } },
      select: { grandTotal: true },
    }),
  ]);
  const revenue = invoices.reduce((s, i) => s.plus(toDecimal(i.grandTotal)), new Decimal(0));
  const collected = invoices.reduce((s, i) => s.plus(toDecimal(i.amountPaid)), new Decimal(0));
  const ingredientIssued = issues.reduce((s, i) => s.plus(toDecimal(i.qty).times(toDecimal(i.unitCostAtIssue))), new Decimal(0));
  const billed = bills.reduce((s, b) => s.plus(toDecimal(b.grandTotal)), new Decimal(0));
  return {
    revenue: revenue.toDecimalPlaces(2).toString(),
    collected: collected.toDecimalPlaces(2).toString(),
    invoiceCount: invoices.length,
    orderCount: orders,
    ingredientIssued: ingredientIssued.toDecimalPlaces(2).toString(),
    vendorBills: billed.toDecimalPlaces(2).toString(),
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
  const rows: Array<{ label: string; periodStart: Date; revenue: string; orderCount: number }> = [];
  for (const start of boundaries) {
    const end = istMonthEnd(start);
    const lt = new Date(end.getTime() + 1);
    const m = await monthMetrics(start, lt);
    rows.push({
      label: `${start.toLocaleString("en-GB", { month: "short", year: "2-digit" })}`,
      periodStart: start,
      revenue: m.revenue,
      orderCount: m.orderCount,
    });
  }
  return rows;
}
