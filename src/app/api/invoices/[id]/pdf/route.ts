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

  // The read carries customer, lines and order; the view builder takes pax
  // off the INVOICE's own finalHeadcount, never the live order.
  const buf = await renderCustomerInvoicePDF(inv);

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${inv.invoiceNo}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
