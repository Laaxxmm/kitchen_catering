import { db } from "@/server/db";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateReport, parseRange } from "@/lib/exports/report-util";
import { toDecimal } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Stock & procurement. Three sheets:
 *   - Stock valuation: every active ingredient with on-hand × avg cost.
 *   - Purchase orders: POs raised in the range.
 *   - Vendor bills:    supplier bills in the range.
 */
export async function GET(req: Request) {
  const denied = await gateReport();
  if (denied) return denied;
  const { from, to, label } = parseRange(req.url);

  const [ingredients, pos, bills] = await Promise.all([
    db.ingredient.findMany({
      where: { active: true },
      select: { sku: true, name: true, unit: true, onHandQty: true, reorderLevel: true, avgUnitCost: true },
      orderBy: { name: "asc" },
    }),
    db.vendorPO.findMany({
      where: { issueDate: { gte: from, lte: to } },
      select: { poNo: true, issueDate: true, status: true, procurementType: true, grandTotal: true, vendor: { select: { name: true } } },
      orderBy: { issueDate: "desc" },
      take: 5000,
    }),
    db.vendorBill.findMany({
      where: { issueDate: { gte: from, lte: to } },
      select: { billNo: true, issueDate: true, status: true, grandTotal: true, amountPaid: true, vendor: { select: { name: true } } },
      orderBy: { issueDate: "desc" },
      take: 5000,
    }),
  ]);

  const stockRows = ingredients.map((i) => {
    const value = toDecimal(i.onHandQty).times(toDecimal(i.avgUnitCost)).toDecimalPlaces(2);
    return [i.sku, i.name, i.unit, Number(i.onHandQty), Number(i.reorderLevel), Number(i.avgUnitCost), Number(value)];
  });
  const poRows = pos.map((p) => [p.poNo, p.issueDate, p.vendor.name, p.procurementType, p.status, Number(p.grandTotal)]);
  const billRows = bills.map((b) => [
    b.billNo, b.issueDate, b.vendor.name, b.status,
    Number(b.grandTotal), Number(b.amountPaid), Number(toDecimal(b.grandTotal).minus(toDecimal(b.amountPaid))),
  ]);

  const buf = await buildWorkbook([
    {
      name: "Stock valuation",
      header: ["SKU", "Ingredient", "Unit", "On hand", "Reorder at", "Avg cost", "Stock value"],
      rows: stockRows,
      widths: [14, 28, 8, 12, 12, 12, 14],
    },
    {
      name: "Purchase orders",
      header: ["PO", "Date", "Vendor", "Type", "Status", "Grand total"],
      rows: poRows,
      widths: [16, 12, 26, 10, 18, 14],
    },
    {
      name: "Vendor bills",
      header: ["Bill", "Date", "Vendor", "Status", "Grand total", "Paid", "Outstanding"],
      rows: billRows,
      widths: [16, 12, 26, 14, 14, 12, 14],
    },
  ]);
  return xlsxResponse(buf, `stock-procurement-${label}.xlsx`);
}
