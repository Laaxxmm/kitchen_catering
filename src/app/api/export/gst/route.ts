import { CustomerInvoiceStatus } from "@prisma/client";
import { db } from "@/server/db";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateReport, parseRange } from "@/lib/exports/report-util";

export const dynamic = "force-dynamic";

/**
 * GST / tax summary for filing. Two sheets:
 *   - Output GST: issued customer invoices with CGST/SGST/IGST breakdown.
 *   - Input GST:  vendor bills with the tax paid on purchases.
 */
export async function GET(req: Request) {
  const denied = await gateReport();
  if (denied) return denied;
  const { from, to, label } = parseRange(req.url);

  const [invoices, bills] = await Promise.all([
    db.customerInvoice.findMany({
      where: { issuedAt: { gte: from, lte: to }, status: { not: CustomerInvoiceStatus.CANCELLED } },
      select: {
        invoiceNo: true, issuedAt: true, placeOfSupplyStateCode: true,
        subtotal: true, cgst: true, sgst: true, igst: true, taxTotal: true, grandTotal: true,
        customer: { select: { name: true } },
      },
      orderBy: { issuedAt: "desc" },
      take: 5000,
    }),
    db.vendorBill.findMany({
      where: { issueDate: { gte: from, lte: to } },
      select: {
        billNo: true, vendorBillNo: true, issueDate: true,
        subtotal: true, taxTotal: true, grandTotal: true,
        vendor: { select: { name: true } },
      },
      orderBy: { issueDate: "desc" },
      take: 5000,
    }),
  ]);

  const outRows = invoices.map((i) => [
    i.invoiceNo, i.issuedAt, i.customer.name, i.placeOfSupplyStateCode,
    Number(i.subtotal), Number(i.cgst), Number(i.sgst), Number(i.igst), Number(i.taxTotal), Number(i.grandTotal),
  ]);
  const inRows = bills.map((b) => [
    b.billNo, b.vendorBillNo ?? "", b.issueDate, b.vendor.name,
    Number(b.subtotal), Number(b.taxTotal), Number(b.grandTotal),
  ]);

  const buf = await buildWorkbook([
    {
      name: "Output GST (sales)",
      header: ["Invoice", "Date", "Customer", "Place of supply", "Taxable", "CGST", "SGST", "IGST", "Total tax", "Grand total"],
      rows: outRows,
      widths: [16, 12, 26, 14, 14, 12, 12, 12, 12, 14],
    },
    {
      name: "Input GST (purchases)",
      header: ["Bill", "Vendor bill no", "Date", "Vendor", "Taxable", "Total tax", "Grand total"],
      rows: inRows,
      widths: [16, 16, 12, 26, 14, 12, 14],
    },
  ]);
  return xlsxResponse(buf, `gst-summary-${label}.xlsx`);
}
