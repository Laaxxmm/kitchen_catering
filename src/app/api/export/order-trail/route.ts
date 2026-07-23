import { Role } from "@prisma/client";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateExport } from "@/lib/exports/report-util";
import { getOrderTrail } from "@/server/reports/order-trail";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

const dt = (iso: string | null) => (iso ? formatIST(new Date(iso), "yyyy-MM-dd HH:mm") : "");

/** One order's full document trail as an Excel workbook — a sheet each for
 *  requisitions, purchase orders (+ approvals), GRNs, bills and payments,
 *  and customer invoices + receipts. ?orderId= */
export async function GET(req: Request) {
  const denied = await gateExport([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  if (denied) return denied;

  const orderId = new URL(req.url).searchParams.get("orderId") ?? "";
  const trail = await getOrderTrail(orderId);
  if (!trail) return new Response("Order not found", { status: 404 });

  const reqRows = trail.requisitions.flatMap((r) =>
    r.lines.map((l) => [r.no, r.kind, r.status, dt(r.createdAt), r.by ?? "", l.item, l.requested, l.issued, l.unit, l.status]),
  );
  const grnRows = trail.purchaseOrders.flatMap((p) =>
    p.grns.map((g) => [p.poNo, p.vendor, g.grnNo, g.status, dt(g.receivedAt)]),
  );
  const billRows = trail.purchaseOrders.flatMap((p) =>
    p.bills.flatMap((b) => {
      const base = [p.poNo, b.billNo, b.vendorBillNo ?? "", b.status, Number(b.grandTotal), Number(b.amountPaid), dt(b.issueDate)];
      if (b.payments.length === 0) return [[...base, "", "", ""]];
      return b.payments.map((pay) => [...base, Number(pay.amount), dt(pay.paidAt), pay.reference ?? ""]);
    }),
  );
  const poRows = trail.purchaseOrders.map((p) => [
    p.poNo, p.vendor, p.status, Number(p.grandTotal), dt(p.issueDate),
    p.managerApprovedBy ?? "", dt(p.managerApprovedAt), p.adminApprovedBy ?? "", dt(p.adminApprovedAt),
  ]);
  const invRows = trail.customerInvoices.flatMap((inv) => {
    const base = [inv.invoiceNo, inv.status, Number(inv.grandTotal), Number(inv.amountPaid), dt(inv.issuedAt)];
    if (inv.payments.length === 0) return [[...base, "", "", ""]];
    return inv.payments.map((pay) => [...base, Number(pay.amount), dt(pay.paidAt), pay.reference ?? ""]);
  });

  const buf = await buildWorkbook([
    { name: "Requisitions", header: ["Req", "Kind", "Status", "Raised", "By", "Item", "Requested", "Issued", "Unit", "Line status"], rows: reqRows },
    { name: "Purchase orders", header: ["PO", "Vendor", "Status", "Total", "Raised", "Mgr approved by", "Mgr approved at", "Admin approved by", "Admin approved at"], rows: poRows },
    { name: "GRNs", header: ["PO", "Vendor", "GRN", "Status", "Received"], rows: grnRows },
    { name: "Bills & payments", header: ["PO", "Bill", "Vendor invoice", "Status", "Total", "Paid", "Issued", "Payment", "Paid at", "Reference"], rows: billRows },
    { name: "Invoices & receipts", header: ["Invoice", "Status", "Total", "Collected", "Issued", "Payment", "Paid at", "Reference"], rows: invRows },
  ]);
  return xlsxResponse(buf, `order-trail-${trail.order.code}.xlsx`);
}
