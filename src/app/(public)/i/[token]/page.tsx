import { notFound } from "next/navigation";
import { getCustomerInvoiceByToken } from "@/server/actions/customer-invoices";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { buildUPILink } from "@/lib/upi";
import { Decimal } from "decimal.js";

export const dynamic = "force-dynamic";

// Token-gated public view. No auth required. Token is unguessable
// (24 bytes base64url). Per SECURITY.md §6, no PII appears in the URL
// query string; everything is in the response body.

// Share links stop working this long after issue — an old forwarded link
// shouldn't expose the customer's billing details forever.
const SHARE_LINK_MAX_AGE_DAYS = 90;

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invoice = await getCustomerInvoiceByToken(token);
  if (!invoice) notFound();

  const issuedAt = invoice.issuedAt ?? invoice.createdAt;
  if (issuedAt && Date.now() - issuedAt.getTime() > SHARE_LINK_MAX_AGE_DAYS * 24 * 3600 * 1000) {
    return (
      <main className="mx-auto max-w-xl bg-ik-paper px-6 py-16 text-center font-ik-sans text-ik-ink">
        <h1 className="text-[18px] font-medium">This invoice link has expired</h1>
        <p className="mt-2 text-[13px] text-ik-ink-2">
          For your security, invoice links stop working {SHARE_LINK_MAX_AGE_DAYS} days after issue.
          Please contact us for a fresh copy of invoice details.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl bg-ik-paper px-6 py-10 font-ik-sans text-ik-ink">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-500">
              {/* Chef toque — matches the brand mark. */}
              <svg width="20" height="20" viewBox="0 0 40 40">
                <circle cx="14" cy="20" r="5" fill="#fff" />
                <circle cx="20" cy="17" r="6" fill="#fff" />
                <circle cx="26" cy="20" r="5" fill="#fff" />
                <rect x="10" y="25" width="20" height="6.5" rx="1.6" fill="#fff" />
              </svg>
            </span>
            <div>
              <div className="text-[15px] font-medium">Greenpath</div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Catering operations</div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Tax invoice</div>
          <div className="font-mono text-[16px] font-medium">{invoice.invoiceNo}</div>
          {invoice.issuedAt && <div className="text-[12px] text-ik-ink-3">Issued {formatIST(invoice.issuedAt, "dd MMM yyyy")}</div>}
          {invoice.dueAt && <div className="text-[12px] text-ik-ink-3">Due {formatIST(invoice.dueAt, "dd MMM yyyy")}</div>}
        </div>
      </header>

      <section className="mb-6 grid gap-4 text-[13px] sm:grid-cols-2">
        <div className="rounded-md border border-ik-rule bg-ik-card p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Bill to</div>
          <div className="mt-1 font-medium">{invoice.customer.name}</div>
          {invoice.customer.gstin && <div className="font-mono text-[12px] text-ik-ink-2">GSTIN {invoice.customer.gstin}</div>}
          <p className="mt-1 whitespace-pre-line text-ik-ink-2">{invoice.customer.billingAddress}</p>
          <div className="mt-1 text-[11.5px] text-ik-ink-3">State {invoice.customer.stateCode}</div>
        </div>
        <div className="rounded-md border border-ik-rule bg-ik-card p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Place of supply</div>
          <div className="mt-1 font-mono">{invoice.placeOfSupplyStateCode}</div>
          {invoice.order && (
            <>
              <div className="mt-3 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Linked order</div>
              <div className="mt-1 font-mono">{invoice.order.code}</div>
              <div className="text-[11.5px] text-ik-ink-3">Event {formatIST(invoice.order.eventDate, "dd MMM yyyy")}</div>
            </>
          )}
        </div>
      </section>

      <table className="w-full border-collapse text-[12.5px]">
        <thead className="border-b border-ik-rule text-left text-ik-ink-3">
          <tr>
            <th className="py-2 pr-2">Description</th>
            <th className="w-16 py-2 pr-2 text-right">Qty</th>
            <th className="w-16">Unit</th>
            <th className="w-20 py-2 pr-2 text-right">Rate ₹</th>
            <th className="w-16 py-2 pr-2 text-right">GST %</th>
            <th className="w-24 py-2 pr-2 text-right">Amount ₹</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {invoice.lines.map((l) => (
            <tr key={l.id} className="border-b border-ik-rule">
              <td className="py-2 pr-2 font-sans">{l.description}</td>
              <td className="py-2 pr-2 text-right">{l.quantity.toString()}</td>
              <td className="py-2 pr-2 text-ik-ink-2">{l.unit}</td>
              <td className="py-2 pr-2 text-right">{l.unitPrice.toString()}</td>
              <td className="py-2 pr-2 text-right">{l.gstRatePct.toString()}</td>
              <td className="py-2 pr-2 text-right">{l.lineTotal.toString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 grid gap-1 text-right font-mono text-[13px]">
        <div><span className="text-ik-ink-3">Subtotal</span> <span className="ml-3">{invoice.subtotal.toString()}</span></div>
        {Number(invoice.cgst) > 0 && <div><span className="text-ik-ink-3">CGST</span> <span className="ml-3">{invoice.cgst.toString()}</span></div>}
        {Number(invoice.sgst) > 0 && <div><span className="text-ik-ink-3">SGST</span> <span className="ml-3">{invoice.sgst.toString()}</span></div>}
        {Number(invoice.igst) > 0 && <div><span className="text-ik-ink-3">IGST</span> <span className="ml-3">{invoice.igst.toString()}</span></div>}
        <div className="text-[15px] font-medium"><span className="text-ik-ink-3">Grand total</span> <span className="ml-3">{formatINR(invoice.grandTotal)}</span></div>
        {Number(invoice.amountPaid) > 0 && <div className="text-positive"><span className="text-ik-ink-3">Paid</span> <span className="ml-3">{formatINR(invoice.amountPaid)}</span></div>}
      </section>

      {(() => {
        const outstanding = new Decimal(invoice.grandTotal.toString()).minus(new Decimal(invoice.amountPaid.toString()));
        if (outstanding.lte(0)) return null;
        const upiLink = buildUPILink({
          amount: outstanding.toDecimalPlaces(2).toString(),
          invoiceNo: invoice.invoiceNo,
        });
        if (!upiLink) return null;
        return (
          <section className="mt-6 rounded-md border border-brand-200 bg-brand-50 p-4 text-[12.5px]">
            <div className="font-medium text-brand-700">Pay via UPI</div>
            <p className="mt-1 text-ik-ink-2">
              Tap the link below on your phone, or scan the QR with any UPI app to pay
              ₹{outstanding.toDecimalPlaces(2).toString()} for this invoice.
            </p>
            <a href={upiLink} className="mt-3 inline-flex rounded-md bg-brand-500 px-4 py-2 font-medium text-white">
              Pay ₹{outstanding.toDecimalPlaces(2).toString()} via UPI
            </a>
          </section>
        );
      })()}

      {invoice.irn && (
        <section className="mt-6 rounded-md border border-ik-rule bg-ik-paper-alt p-4 text-[11.5px] font-mono">
          <div className="text-ik-ink-3 uppercase tracking-[0.12em]">E-invoice</div>
          <div className="mt-1"><span className="text-ik-ink-3">IRN:</span> <span className="break-all">{invoice.irn}</span></div>
          {invoice.ackNo && <div><span className="text-ik-ink-3">Ack:</span> {invoice.ackNo}</div>}
        </section>
      )}

      <footer className="mt-10 border-t border-ik-rule pt-4 text-[11px] text-ik-ink-3">
        Greenpath · This invoice was generated by Greenpath catering operations software. Visit
        the link this page came from for the latest copy.
      </footer>
    </main>
  );
}
