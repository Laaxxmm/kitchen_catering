import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateReport, parseRange } from "@/lib/exports/report-util";
import { getOrderTimelines } from "@/server/reports/order-timeline";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

const dt = (d: Date | null) => (d ? formatIST(d, "yyyy-MM-dd HH:mm") : "");

/** Every order with an event in the range, one row each, every desk's stamp
 *  as a column, and the delivery verdict. ?from=&to= */
export async function GET(req: Request) {
  const denied = await gateReport();
  if (denied) return denied;
  const { from, to, label } = parseRange(req.url);
  const rows = await getOrderTimelines(from, to);

  const header = [
    "Order", "Customer", "Channel", "Status", "Pax", "Event date", "Deliver by",
    "Taken", "Accepted", "Kitchen took it", "Store issued (first)", "Store issued (last)",
    "Cooking started", "Cooked", "Handed over", "F&B ready", "Manpower requested", "Manpower approved",
    "Dispatched", "Delivered", "Verdict", "Minutes late", "Cancelled",
  ];
  const data = rows.map((r) => [
    r.code, r.customer, r.channel, r.status, r.headcount, dt(r.eventDate), dt(r.deliveryWindowStart),
    dt(r.taken), dt(r.accepted), dt(r.kitchenTook), dt(r.storeIssuedFirst), dt(r.storeIssuedLast),
    dt(r.cookingStarted), dt(r.cooked), dt(r.handedOver), dt(r.fnbReady), dt(r.manpowerRequested), dt(r.manpowerApproved),
    dt(r.dispatched), dt(r.delivered),
    r.cancelled ? "Cancelled" : r.verdict.kind === "on-time" ? "On time" : r.verdict.kind === "late" ? "Late" : "Pending",
    r.verdict.kind === "late" ? r.verdict.lateMinutes : "",
    dt(r.cancelled),
  ]);
  const buf = await buildWorkbook([{ name: "Order timeline", header, rows: data }]);
  return xlsxResponse(buf, `order-timeline-${label}.xlsx`);
}
