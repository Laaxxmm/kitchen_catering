import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateExport } from "@/lib/exports/report-util";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Chef requisitions (kitchen → store) as an Excel list. */
export async function GET() {
  const denied = await gateExport([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD]);
  if (denied) return denied;

  const reqs = await db.chefRequisition.findMany({
    include: {
      order: { select: { code: true, eventDate: true, customer: { select: { name: true } } } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const rows = reqs.map((r) => [
    r.requisitionNo,
    r.order?.code ?? "General request",
    r.order?.customer.name ?? "Kitchen stock",
    r.order ? formatIST(r.order.eventDate, "yyyy-MM-dd") : "",
    r._count.lines,
    r.status,
    formatIST(r.createdAt, "yyyy-MM-dd HH:mm"),
  ]);

  const buf = await buildWorkbook([
    {
      name: "Requisitions",
      header: ["Req no", "Order", "Customer", "Event", "Lines", "Status", "Created"],
      rows,
      widths: [16, 16, 28, 12, 8, 18, 18],
    },
  ]);
  return xlsxResponse(buf, `requisitions-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
