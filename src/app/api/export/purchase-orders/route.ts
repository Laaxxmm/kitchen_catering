import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateExport } from "@/lib/exports/report-util";
import { formatIST } from "@/lib/time";
import { toDecimal } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Vendor purchase orders as an Excel list. */
export async function GET() {
  const denied = await gateExport([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS]);
  if (denied) return denied;

  const pos = await db.vendorPO.findMany({
    include: {
      vendor: { select: { name: true, code: true } },
      order: { select: { code: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { issueDate: "desc" },
    take: 3000,
  });

  const rows = pos.map((p) => [
    p.poNo,
    formatIST(p.issueDate, "yyyy-MM-dd"),
    `${p.vendor.code} · ${p.vendor.name}`,
    p.procurementType,
    p.order?.code ?? "",
    p._count.lines,
    Number(toDecimal(p.subtotal)),
    Number(toDecimal(p.taxTotal)),
    Number(toDecimal(p.grandTotal)),
    p.status,
  ]);

  const buf = await buildWorkbook([
    {
      name: "Purchase orders",
      header: ["PO", "Date", "Vendor", "Type", "For order", "Lines", "Subtotal", "Tax", "Grand total", "Status"],
      rows,
      widths: [16, 12, 28, 10, 16, 8, 14, 12, 14, 16],
    },
  ]);
  return xlsxResponse(buf, `purchase-orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
