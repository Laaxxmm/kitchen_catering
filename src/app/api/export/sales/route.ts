import { db } from "@/server/db";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateReport, parseRange } from "@/lib/exports/report-util";
import { computeOrderPnL } from "@/lib/pnl";

export const dynamic = "force-dynamic";

/**
 * Sales & order P&L. Orders whose event falls in the range, each with its
 * revenue, cost split and margin. Capped at 300 orders (widen the range in
 * chunks for very large periods).
 */
export async function GET(req: Request) {
  const denied = await gateReport();
  if (denied) return denied;
  const { from, to, label } = parseRange(req.url);

  const orders = await db.order.findMany({
    where: { eventDate: { gte: from, lte: to } },
    select: { id: true, code: true, eventDate: true, channel: true, mealType: true, headcount: true, contractValue: true, status: true, customer: { select: { name: true } } },
    orderBy: { eventDate: "desc" },
    take: 300,
  });

  const rows: Array<Array<string | number | Date | null>> = [];
  for (const o of orders) {
    const pnl = await computeOrderPnL(o.id);
    rows.push([
      o.code,
      o.eventDate,
      o.customer.name,
      o.channel,
      o.mealType,
      o.headcount,
      Number(o.contractValue),
      pnl ? Number(pnl.revenue.invoiced) : 0,
      pnl ? Number(pnl.revenue.collected) : 0,
      pnl ? Number(pnl.ingredientCost.used) : 0,
      pnl ? Number(pnl.labourCost) : 0,
      pnl ? Number(pnl.overheadCost) : 0,
      pnl ? Number(pnl.totalCost) : 0,
      pnl ? Number(pnl.grossProfit) : 0,
      pnl ? Number(pnl.grossMarginPct) : 0,
      o.status,
    ]);
  }

  const buf = await buildWorkbook([
    {
      name: "Sales & P&L",
      header: ["Order", "Event date", "Customer", "Channel", "Meal", "Pax", "Contract value", "Revenue (invoiced)", "Collected", "Ingredient cost", "Labour", "Overhead", "Total cost", "Gross profit", "Margin %", "Status"],
      rows,
      widths: [16, 12, 26, 10, 10, 6, 15, 16, 12, 14, 10, 10, 12, 13, 9, 18],
    },
  ]);
  return xlsxResponse(buf, `sales-pnl-${label}.xlsx`);
}
