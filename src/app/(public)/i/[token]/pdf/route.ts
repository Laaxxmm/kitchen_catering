import { getCustomerInvoiceByToken } from "@/server/actions/customer-invoices";
import { displayInvoiceNo, renderCustomerInvoicePDF } from "@/server/pdf/customer-invoice";
import { shareLinkExpired } from "@/lib/customer-invoice-gates";

/**
 * GET /i/[token]/pdf — the customer's own copy of the invoice, same document
 * the accounts desk downloads. Token-gated like the page it sits under: an
 * unissued draft or an expired link is a plain 404, never a redirect to
 * login (customers have no login).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getCustomerInvoiceByToken(token);
  if (!inv || shareLinkExpired(inv.issuedAt ?? inv.createdAt)) {
    return new Response(null, { status: 404 });
  }
  const buf = await renderCustomerInvoicePDF(inv);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice ${displayInvoiceNo(inv.invoiceNo).replace("/", "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
