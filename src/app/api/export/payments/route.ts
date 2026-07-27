import { CustomerInvoiceStatus, VendorBillStatus } from "@prisma/client";
import { db } from "@/server/db";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateReport } from "@/lib/exports/report-util";
import { toDecimal } from "@/lib/money";
import { EXCLUDE_PROFORMA } from "@/lib/invoice-kinds";

export const dynamic = "force-dynamic";

/**
 * Payments — money owed to us (receivables) and money we owe (payables).
 * Snapshot of everything still outstanding, so no date range.
 */
export async function GET() {
  const denied = await gateReport();
  if (denied) return denied;
  const now = new Date();

  const [invoices, bills] = await Promise.all([
    db.customerInvoice.findMany({
      where: { status: { in: [CustomerInvoiceStatus.ISSUED, CustomerInvoiceStatus.PARTIAL] }, ...EXCLUDE_PROFORMA },
      select: { invoiceNo: true, issuedAt: true, dueAt: true, grandTotal: true, amountPaid: true, status: true, customer: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
      take: 5000,
    }),
    db.vendorBill.findMany({
      where: { status: { in: [VendorBillStatus.MATCHED, VendorBillStatus.APPROVED, VendorBillStatus.OVERDUE, VendorBillStatus.DISCREPANCY] } },
      select: { billNo: true, issueDate: true, dueDate: true, grandTotal: true, amountPaid: true, status: true, vendor: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
      take: 5000,
    }),
  ]);

  const arRows = invoices
    .map((i) => {
      const outstanding = toDecimal(i.grandTotal).minus(toDecimal(i.amountPaid));
      const overdue = i.dueAt && i.dueAt < now ? "Overdue" : "";
      return { outstanding, row: [i.invoiceNo, i.customer.name, i.issuedAt, i.dueAt ?? null, Number(i.grandTotal), Number(i.amountPaid), Number(outstanding.toDecimalPlaces(2)), i.status, overdue] };
    })
    .filter((x) => x.outstanding.gt(0))
    .map((x) => x.row);

  const apRows = bills
    .map((b) => {
      const outstanding = toDecimal(b.grandTotal).minus(toDecimal(b.amountPaid));
      const overdue = b.dueDate && b.dueDate < now ? "Overdue" : "";
      return { outstanding, row: [b.billNo, b.vendor.name, b.issueDate, b.dueDate ?? null, Number(b.grandTotal), Number(b.amountPaid), Number(outstanding.toDecimalPlaces(2)), b.status, overdue] };
    })
    .filter((x) => x.outstanding.gt(0))
    .map((x) => x.row);

  const buf = await buildWorkbook([
    {
      name: "Receivables (AR)",
      header: ["Invoice", "Customer", "Issued", "Due", "Grand total", "Paid", "Outstanding", "Status", "Flag"],
      rows: arRows,
      widths: [16, 26, 12, 12, 14, 12, 14, 12, 10],
    },
    {
      name: "Payables (AP)",
      header: ["Bill", "Vendor", "Issued", "Due", "Grand total", "Paid", "Outstanding", "Status", "Flag"],
      rows: apRows,
      widths: [16, 26, 12, 12, 14, 12, 14, 12, 10],
    },
  ]);
  return xlsxResponse(buf, `payments-ar-ap-${now.toISOString().slice(0, 10)}.xlsx`);
}
