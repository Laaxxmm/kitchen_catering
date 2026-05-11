import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { listOrders } from "@/server/actions/orders";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const orders = await listOrders({});
  const rows = orders.map((o) => [
    o.code,
    o.customer.name,
    formatIST(o.eventDate, "yyyy-MM-dd"),
    o.mealType,
    o.headcount,
    Number(o.contractValue),
    o.status,
    formatIST(o.createdAt, "yyyy-MM-dd"),
  ]);
  const buf = await buildWorkbook([
    {
      name: "Orders",
      header: ["Code", "Customer", "Event date", "Meal", "Headcount", "Contract value", "Status", "Created"],
      rows,
      widths: [16, 28, 12, 10, 10, 16, 22, 12],
    },
  ]);
  return xlsxResponse(buf, `orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
