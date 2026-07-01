import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateExport } from "@/lib/exports/report-util";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Deliveries as an Excel list. */
export async function GET() {
  const denied = await gateExport([Role.ADMIN, Role.MANAGER]);
  if (denied) return denied;

  const deliveries = await db.delivery.findMany({
    include: {
      order: { select: { code: true, deliveryAddress: true, customer: { select: { name: true } } } },
      driver: { select: { name: true } },
    },
    orderBy: { scheduledAt: "desc" },
    take: 3000,
  });

  const rows = deliveries.map((d) => [
    d.deliveryNo,
    d.order.code,
    d.order.customer.name,
    d.driver?.name ?? "—",
    d.vehicleNo ?? "",
    formatIST(d.scheduledAt, "yyyy-MM-dd HH:mm"),
    d.deliveredAt ? formatIST(d.deliveredAt, "yyyy-MM-dd HH:mm") : "",
    d.status,
    d.order.deliveryAddress,
  ]);

  const buf = await buildWorkbook([
    {
      name: "Deliveries",
      header: ["Delivery", "Order", "Customer", "Driver", "Vehicle", "Scheduled", "Delivered", "Status", "Address"],
      rows,
      widths: [16, 16, 26, 20, 12, 18, 18, 14, 32],
    },
  ]);
  return xlsxResponse(buf, `deliveries-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
