import { IngredientReturnStatus } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { toDecimal } from "./money";
import { computeOrderRecipeCost } from "./recipe-cost";
import { EXCLUDE_PROFORMA } from "./invoice-kinds";

export interface OrderPnL {
  orderId: string;
  orderCode: string;
  customerName: string;
  status: string;
  revenue: { invoiced: Decimal; collected: Decimal };
  ingredientCost: {
    planned: Decimal;
    actual: Decimal;
    // Full recipe cost of every dish — includes ingredients used from existing
    // store stock that were never separately issued.
    recipe: Decimal;
    // What profitability actually charges: the greater of recipe cost and what
    // was issued (so nothing is undercounted, and ad-hoc extras still count).
    used: Decimal;
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
 *   Ingredient actual     = sum(IngredientIssue.qty × unitCostAtIssue) for the order,
 *                           less sum(IngredientReturnLine.quantity × unitCost) for stock
 *                           the kitchen sent back — credited at the price it was
 *                           issued at, so the charge actually reverses
 *   Labour              = sum(TimeEntry.minutes/60 × hourly rate from SalaryStructure
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
      items: { select: { dishId: true, portions: true } },
    },
  });
  if (!order) return null;

  // Revenue
  const invoices = await db.customerInvoice.findMany({
    // A proforma carries the full order value at status ISSUED but is not
    // revenue — counting it alongside the real invoice doubled the figure.
    where: { orderId, status: { not: "CANCELLED" }, ...EXCLUDE_PROFORMA },
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

  // …minus what came back. The return line carries the issue's own unit cost,
  // so the credit is at the price this order was charged, and it reaches this
  // order only because the line points at an issue that belongs to it.
  // CONFIRMED only: the chef declaring that 2 kg is on its way back does not
  // credit this order's food cost. The stock has to physically reach the
  // store and be counted in first — otherwise the event reads cheaper than
  // it is, on a promise.
  const returnLines = await db.ingredientReturnLine.findMany({
    where: { issue: { orderId }, return: { status: IngredientReturnStatus.CONFIRMED } },
    select: {
      quantity: true,
      unitCost: true,
      issue: { select: { ingredientId: true } },
    },
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
  for (const r of returnLines) {
    // The ingredient always already has a bucket: a return can only exist
    // against an issue, and every issue for this order was just folded in.
    const cur = byIng.get(r.issue.ingredientId);
    if (!cur) continue;
    const qty = toDecimal(r.quantity);
    cur.actualQty = cur.actualQty.minus(qty);
    cur.actualCost = cur.actualCost.minus(qty.times(toDecimal(r.unitCost)));
  }
  const ingLines = [...byIng.values()].map((c) => ({
    ingredient: c.ingredient,
    unit: c.unit,
    planned: { qty: c.plannedQty, cost: c.plannedCost.toDecimalPlaces(2) },
    actual: { qty: c.actualQty, cost: c.actualCost.toDecimalPlaces(2) },
    variance: c.actualCost.minus(c.plannedCost).toDecimalPlaces(2),
  }));

  const plannedCost = ingLines.reduce((s, l) => s.plus(l.planned.cost), new Decimal(0));
  const issuedCost = ingLines.reduce((s, l) => s.plus(l.actual.cost), new Decimal(0));

  // Recipe-based cost — the full cost of every dish's ingredients, including
  // those used from existing store stock. Profitability charges the greater of
  // this and what was issued, so nothing is undercounted (and recipes that
  // aren't set up gracefully fall back to the issued cost).
  const recipeCost = await computeOrderRecipeCost(
    order.items.map((it) => ({ dishId: it.dishId, portions: toDecimal(it.portions) })),
  );
  const usedCost = recipeCost.gt(issuedCost) ? recipeCost : issuedCost;

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

  const totalCost = usedCost.plus(labour).plus(overhead).toDecimalPlaces(2);
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
      actual: issuedCost.toDecimalPlaces(2),
      recipe: recipeCost.toDecimalPlaces(2),
      used: usedCost.toDecimalPlaces(2),
      variance: issuedCost.minus(plannedCost).toDecimalPlaces(2),
      lines: ingLines,
    },
    labourCost: labour,
    overheadCost: overhead.toDecimalPlaces(2),
    totalCost,
    grossProfit,
    grossMarginPct,
  };
}
