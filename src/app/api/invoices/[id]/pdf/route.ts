import { notFound } from "next/navigation";
import { renderCustomerInvoicePDF } from "@/server/pdf/customer-invoice";
import { getCustomerInvoice } from "@/server/actions/customer-invoices";

/**
 * GET /api/invoices/[id]/pdf — streams the invoice PDF.
 *
 * Auth: leverages getCustomerInvoice's role gate (READ_ROLES). This route
 * has no middleware rule of its own, so that gate is the only check — a
 * role outside READ_ROLES gets an AuthorizationError, not a PDF.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await getCustomerInvoice(id);
  if (!inv) notFound();

  const buf = await renderCustomerInvoicePDF({
    invoiceNo: inv.invoiceNo,
    kind: inv.kind,
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
    orderCode: inv.order?.code ?? null,
    // Live pax/meal — deliberately NOT the invoice line snapshot.
    order: inv.order ? { headcount: inv.order.headcount, mealType: inv.order.mealType } : null,
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
