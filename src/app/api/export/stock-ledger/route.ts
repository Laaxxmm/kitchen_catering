import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateReport, parseRange } from "@/lib/exports/report-util";
import { getStockLedger, type LedgerStore } from "@/server/reports/stock-ledger";

export const dynamic = "force-dynamic";

/** Per-item stock ledger (opening → in / out / adjust → closing) for a store
 *  and date range, as one Excel sheet. ?store=kitchen|banquet&from=&to= */
export async function GET(req: Request) {
  const denied = await gateReport();
  if (denied) return denied;

  const { from, to, label } = parseRange(req.url);
  const store: LedgerStore =
    new URL(req.url).searchParams.get("store") === "banquet" ? "banquet" : "kitchen";
  const { rows } = await getStockLedger(store, from, to);

  const header = ["SKU", "Item", "Category", "Unit", "Opening", "In", "Out", "Adjust", "Closing", "Value (INR)"];
  const data = rows.map((r) => [
    r.sku, r.name, r.category ?? "", r.unit, r.opening, r.inQty, r.outQty, r.adjustQty, r.closing, r.value ?? "",
  ]);

  const buf = await buildWorkbook([{ name: `${store} stock`.slice(0, 31), header, rows: data }]);
  return xlsxResponse(buf, `stock-ledger-${store}-${label}.xlsx`);
}
