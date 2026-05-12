import { notFound } from "next/navigation";
import { renderCustomerInvoicePDF } from "@/server/pdf/customer-invoice";
import { getCustomerInvoice } from "@/server/actions/customer-invoices";

/**
 * GET /api/invoices/[id]/pdf — streams the invoice PDF.
 *
 * Auth: leverages getCustomerInvoice's role gate. DELIVERY role won't
 * see this URL via the UI; if they hit it directly, the inner
 * requireSession() still admits any signed-in user — we may want to
 * tighten this with a role check if invoice PDF visibility becomes a
 * concern. For now anyone signed in with access to the invoice page
 * can download.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await getCustomerInvoice(id);
  if (!inv) notFound();

  const buf = await renderCustomerInvoicePDF({
    invoiceNo: inv.invoiceNo,
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
    orderCode: inv.order?.code ?? null,
    placeOfSupplyStateCode: inv.placeOfSupplyStateCode,
    irn: inv.irn,
    ackNo: inv.ackNo,
    ackDate: inv.ackDate,
    customer: {
      name: inv.customer.name,
      gstin: inv.customer.gstin,
      billingAddress: inv.customer.billingAddress,
      stateCode: inv.customer.stateCode,
    },
    lines: inv.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity.toString(),
      unit: l.unit,
      unitPrice: l.unitPrice.toString(),
      gstRatePct: l.gstRatePct.toString(),
      lineTotal: l.lineTotal.toString(),
    })),
    subtotal: inv.subtotal.toString(),
    cgst: inv.cgst.toString(),
    sgst: inv.sgst.toString(),
    igst: inv.igst.toString(),
    taxTotal: inv.taxTotal.toString(),
    grandTotal: inv.grandTotal.toString(),
    amountPaid: inv.amountPaid.toString(),
    notes: inv.notes,
    terms: inv.termsMd,
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${inv.invoiceNo}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
