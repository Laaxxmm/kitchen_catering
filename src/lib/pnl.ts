import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { toDecimal } from "./money";

export interface OrderPnL {
  orderId: string;
  orderCode: string;
  customerName: string;
  status: string;
  revenue: { invoiced: Decimal; collected: Decimal };
  ingredientCost: {
    planned: Decimal;
    actual: Decimal;
    variance: Decimal;
    lines: Array<{
      ingredient: string;
      unit: string;
      planned: { qty: Decimal; cost: Decimal };
      actual: { qty: Decimal; cost: Decimal };
      variance: Decimal;
    }>;
  };
  labourCost: Decimal;
  overheadCost: Decimal;
  totalCost: Decimal;
  grossProfit: Decimal;
  grossMarginPct: Decimal;
}

/**
 * Per-order P&L. Pulls from existing tables:
 *   Revenue (accrual)     = sum of issued CustomerInvoice.grandTotal
 *   Revenue (cash)        = sum of CustomerInvoicePayment.amount (non-reversed)
 *   Ingredient planned    = sum(ChefRequisitionLine.requestedQty × unitCostSnapshot)
 *   Ingredient actual     = sum(IngredientIssue.qty × unitCostAtIssue) for the order
 *   Labour                = sum(TimeEntry.minutes/60 × hourly rate from SalaryStructure
 *                                effective at the time entry's clockIn date)
 *   Overhead              = sum of OrderOverheadAllocation.amount (manual allocations)
 *
 * Accrual basis used by default. The Settings flag `accounting.basis="cash"`
 * could later flip revenue to use collected; not wired yet.
 */
export async function computeOrderPnL(orderId: string): Promise<OrderPnL | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, code: true, status: true, eventDate: true,
      customer: { select: { name: true } },
    },
  });
  if (!order) return null;

  // Revenue
  const invoices = await db.customerInvoice.findMany({
    where: { orderId, status: { not: "CANCELLED" } },
    select: { grandTotal: true, amountPaid: true },
  });
  const revenueInvoiced = invoices.reduce((s, i) => s.plus(toDecimal(i.grandTotal)), new Decimal(0));
  const revenueCollected = invoices.reduce((s, i) => s.plus(toDecimal(i.amountPaid)), new Decimal(0));

  // Ingredient planned — sum across all chef requisitions for the order
  const reqLines = await db.chefRequisitionLine.findMany({
    where: { requisition: { orderId } },
    include: { ingredient: { select: { name: true, unit: true } } },
  });

  // Ingredient actual — IngredientIssue rows for the order
  const issues = await db.ingredientIssue.findMany({
    where: { orderId },
    include: { ingredient: { select: { id: true, name: true, unit: true } } },
  });

  // Build per-ingredient roll-up
  const byIng = new Map<string, {
    ingredient: string; unit: string;
    plannedQty: Decimal; plannedCost: Decimal;
    actualQty: Decimal; actualCost: Decimal;
  }>();
  for (const r of reqLines) {
    const key = r.ingredientId;
    const cur = byIng.get(key) ?? {
      ingredient: r.ingredient.name, unit: r.ingredient.unit,
      plannedQty: new Decimal(0), plannedCost: new Decimal(0),
      actualQty: new Decimal(0), actualCost: new Decimal(0),
    };
    const qty = toDecimal(r.requestedQty);
    cur.plannedQty = cur.plannedQty.plus(qty);
    cur.plannedCost = cur.plannedCost.plus(qty.times(toDecimal(r.unitCostSnapshot)));
    byIng.set(key, cur);
  }
  for (const i of issues) {
    const key = i.ingredientId;
    const cur = byIng.get(key) ?? {
      ingredient: i.ingredient.name, unit: i.ingredient.unit,
      plannedQty: new Decimal(0), plannedCost: new Decimal(0),
      actualQty: new Decimal(0), actualCost: new Decimal(0),
    };
    const qty = toDecimal(i.qty);
    cur.actualQty = cur.actualQty.plus(qty);
    cur.actualCost = cur.actualCost.plus(qty.times(toDecimal(i.unitCostAtIssue)));
    byIng.set(key, cur);
  }
  const ingLines = [...byIng.values()].map((c) => ({
    ingredient: c.ingredient,
    unit: c.unit,
    planned: { qty: c.plannedQty, cost: c.plannedCost.toDecimalPlaces(2) },
    actual: { qty: c.actualQty, cost: c.actualCost.toDecimalPlaces(2) },
    variance: c.actualCost.minus(c.plannedCost).toDecimalPlaces(2),
  }));

  const plannedCost = ingLines.reduce((s, l) => s.plus(l.planned.cost), new Decimal(0));
  const actualCost = ingLines.reduce((s, l) => s.plus(l.actual.cost), new Decimal(0));

  // Labour — TimeEntry minutes × current hourly rate from SalaryStructure
  const timeEntries = await db.timeEntry.findMany({
    where: { orderId, status: "APPROVED" },
    select: { employeeId: true, minutes: true, clockIn: true },
  });
  let labour = new Decimal(0);
  for (const te of timeEntries) {
    if (!te.minutes) continue;
    const structure = await db.salaryStructure.findFirst({
      where: {
        employeeId: te.employeeId,
        effectiveFrom: { lte: te.clockIn },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: te.clockIn } }],
      },
      select: { hourlyRate: true, monthlySalary: true, type: true },
    });
    if (!structure?.hourlyRate) continue;
    const hours = new Decimal(te.minutes).div(60);
    labour = labour.plus(hours.times(toDecimal(structure.hourlyRate)));
  }
  labour = labour.toDecimalPlaces(2);

  // Overhead
  const overheads = await db.orderOverheadAllocation.findMany({
    where: { orderId },
    select: { amount: true },
  });
  const overhead = overheads.reduce((s, o) => s.plus(toDecimal(o.amount)), new Decimal(0));

  const totalCost = actualCost.plus(labour).plus(overhead).toDecimalPlaces(2);
  const grossProfit = revenueInvoiced.minus(totalCost).toDecimalPlaces(2);
  const grossMarginPct = revenueInvoiced.gt(0)
    ? grossProfit.div(revenueInvoiced).times(100).toDecimalPlaces(2)
    : new Decimal(0);

  return {
    orderId: order.id,
    orderCode: order.code,
    customerName: order.customer.name,
    status: order.status,
    revenue: { invoiced: revenueInvoiced.toDecimalPlaces(2), collected: revenueCollected.toDecimalPlaces(2) },
    ingredientCost: {
      planned: plannedCost.toDecimalPlaces(2),
      actual: actualCost.toDecimalPlaces(2),
      variance: actualCost.minus(plannedCost).toDecimalPlaces(2),
      lines: ingLines,
    },
    labourCost: labour,
    overheadCost: overhead.toDecimalPlaces(2),
    totalCost,
    grossProfit,
    grossMarginPct,
  };
}
