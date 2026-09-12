import { notFound } from "next/navigation";
import { Decimal } from "decimal.js";
import { getCustomerInvoiceByToken } from "@/server/actions/customer-invoices";
import { buildInvoiceView } from "@/server/pdf/customer-invoice";
import { SHARE_LINK_MAX_AGE_DAYS, shareLinkExpired } from "@/lib/customer-invoice-gates";
import { buildUPILink } from "@/lib/upi";

export const dynamic = "force-dynamic";

// Token-gated public view. No auth required. Token is unguessable
// (24 bytes base64url). Per SECURITY.md §6, no PII appears in the URL
// query string; everything is in the response body.
//
// The page is the same document as the PDF — one view, drawn in HTML — so
// what the customer sees on the link is what prints. The Download PDF
// button gives them the file.

const COLUMNS = ["Sl.No", "Date", "Particular", "No of Pax", "Rate", "No Of Days", "Taxable Amt"];
const cell = "border-b border-r border-black px-2 py-1.5 last:border-r-0";
const num = `${cell} text-right tabular-nums`;

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invoice = await getCustomerInvoiceByToken(token);
  if (!invoice) notFound();

  if (shareLinkExpired(invoice.issuedAt ?? invoice.createdAt)) {
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

  const view = await buildInvoiceView(invoice);
  const outstanding = new Decimal(invoice.grandTotal.toString()).minus(new Decimal(invoice.amountPaid.toString()));
  const upiLink = outstanding.gt(0)
    ? buildUPILink({ amount: outstanding.toDecimalPlaces(2).toString(), invoiceNo: invoice.invoiceNo })
    : null;

  return (
    <main className="mx-auto max-w-3xl bg-ik-paper px-3 py-6 font-ik-sans text-ik-ink sm:px-6 sm:py-10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[12.5px] text-ik-ink-2">
          {view.title} <span className="font-mono">{view.displayNo}</span>
        </div>
        <a
          href={`/i/${token}/pdf`}
          className="inline-flex rounded-md bg-brand-500 px-4 py-2 text-[13px] font-medium text-white"
        >
          Download PDF
        </a>
      </div>

      {/* The document — the printed layout, in HTML */}
      <article className="border border-black bg-white text-[12.5px] leading-snug text-black">
        <h1 className="mt-3 text-center text-[19px] font-semibold">{view.title}</h1>
        {view.proforma && <p className="text-center text-[11px] italic">PROFORMA — not a tax invoice</p>}
        <div className="mt-1 text-center text-[15px] font-semibold">{view.seller.name}</div>
        {view.seller.addressLines.map((l, i) => (
          <div key={i} className="text-center">{l}</div>
        ))}
        {view.seller.email && <div className="text-center">Email : {view.seller.email}</div>}
        {view.seller.phoneLine && <div className="text-center">{view.seller.phoneLine}</div>}

        <div className="mt-2 flex items-start justify-between border-y border-black px-3 py-1.5">
          <div className="font-semibold">GSTIN : {view.seller.gstin}</div>
          <div className="text-right">
            <div>Date : {view.dateStr}</div>
            <div>Inv No: {view.displayNo}</div>
          </div>
        </div>

        <div className="px-3 py-2">
          <div className="text-[11px] font-semibold">TO</div>
          <div className="text-[13.5px] font-semibold">{view.customer.name}</div>
          {view.customer.addressLines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
          {view.customer.metaLines.map((l) => (
            <div key={l} className="mt-0.5 font-semibold">{l}</div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse border-t border-black">
            <thead className="bg-[#EFEFEF]">
              <tr>
                {COLUMNS.map((c, i) => (
                  <th key={c} className={`${cell} text-[11.5px] font-semibold ${i >= 3 ? "text-right" : "text-left"}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.sl}>
                  <td className={cell}>{r.sl}</td>
                  <td className={`${cell} whitespace-nowrap`}>{r.date}</td>
                  <td className={cell}>{r.particular}</td>
                  <td className={num}>{r.pax}</td>
                  <td className={num}>{r.rate}</td>
                  <td className={num}>{r.days}</td>
                  <td className={num}>{r.taxable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <table className="w-full border-collapse sm:w-[45%]">
            <tbody>
              {view.totals.map((t) => (
                <tr key={t.label} className={t.grand ? "text-[13.5px] font-semibold" : ""}>
                  <td className="border-b border-black px-3 py-1">{t.label}</td>
                  <td className="border-b border-black px-3 py-1 text-right tabular-nums">{t.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-b border-black px-3 py-2">
          <span className="font-semibold">Rupees in Words: </span>
          {view.words}
        </div>

        {view.bank && (
          <div className="px-3 py-2">
            <div className="mb-1 font-semibold">For Online payment details furnished below</div>
            {view.bank.rows.length > 0 ? (
              <table className="w-full border-collapse border border-black sm:w-[70%]">
                <tbody>
                  {view.bank.rows.map(([k, v]) => (
                    <tr key={k}>
                      <td className="w-[40%] border-b border-r border-black px-2 py-1 font-semibold">{k}</td>
                      <td className="border-b border-black px-2 py-1">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              view.bank.freeLines.map((l, i) => <div key={i}>{l}</div>)
            )}
          </div>
        )}

        <div className="px-3 pb-5 pt-3">
          <div>Thanking You</div>
          <div className="h-10" />
          <div className="text-right font-semibold">{view.seller.name.toUpperCase()}</div>
        </div>
      </article>

      {upiLink && (
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
      )}

      {invoice.irn && (
        <section className="mt-6 rounded-md border border-ik-rule bg-ik-paper-alt p-4 text-[11.5px] font-mono">
          <div className="text-ik-ink-3 uppercase tracking-[0.12em]">E-invoice</div>
          <div className="mt-1"><span className="text-ik-ink-3">IRN:</span> <span className="break-all">{invoice.irn}</span></div>
          {invoice.ackNo && <div><span className="text-ik-ink-3">Ack:</span> {invoice.ackNo}</div>}
        </section>
      )}

      <footer className="mt-8 text-[11px] text-ik-ink-3">
        Generated by {view.seller.name}. Visit the link this page came from for the latest copy.
      </footer>
    </main>
  );
}
