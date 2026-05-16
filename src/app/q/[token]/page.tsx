import { notFound } from "next/navigation";
import { Wordmark } from "@/components/ik";
import { getQuoteByShareToken } from "@/server/actions/quotes";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Public token-gated view of a quote. Anyone with the share-token URL
 * can see the quote line items and total — no login required. The
 * token is generated when the quote is created, so the URL is safe to
 * email or WhatsApp to the customer.
 *
 * Read-only; the customer's "Accept" is logged by the salesperson in
 * the dashboard when they get a reply.
 */
export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const quote = await getQuoteByShareToken(token);
  if (!quote) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between border-b border-ik-rule pb-4">
        <Wordmark size={18} />
        <div className="text-right">
          <div className="font-mono text-[18px] font-medium">{quote.quoteNo}</div>
          {quote.version > 1 && (
            <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Version {quote.version}</div>
          )}
        </div>
      </header>

      <section className="mb-6">
        <h1 className="text-[22px] font-semibold text-ik-ink">{quote.title}</h1>
        <p className="mt-1 text-[13px] text-ik-ink-2">
          Quote prepared for <strong>{quote.customer.name}</strong>
        </p>
        {quote.eventDate && (
          <p className="mt-1 text-[12.5px] text-ik-ink-3">
            Event date: <span className="font-mono text-ik-ink-2">{formatIST(quote.eventDate, "EEE d MMM yyyy")}</span>
            {quote.headcount ? ` · ${quote.headcount} pax` : ""}
            {quote.mealType ? ` · ${quote.mealType.toLowerCase().replace("_", " ")}` : ""}
          </p>
        )}
        {quote.deliveryAddress && (
          <p className="mt-1 text-[12.5px] text-ik-ink-3">Delivery: {quote.deliveryAddress}</p>
        )}
        {quote.validUntil && (
          <p className="mt-2 inline-block rounded-full bg-amber-wash px-3 py-1 text-[11.5px] font-medium text-amber">
            Valid until {formatIST(quote.validUntil, "EEE d MMM yyyy")}
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-md border border-ik-rule">
        <table className="w-full text-[13px]">
          <thead className="bg-ik-paper-alt text-left text-ik-ink-3">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit ₹</th>
              <th className="px-3 py-2 text-right">GST %</th>
              <th className="px-3 py-2 text-right">Total ₹</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.id} className="border-t border-ik-rule">
                <td className="px-3 py-2">{l.description}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {l.quantity.toString()} {l.unit}
                </td>
                <td className="px-3 py-2 text-right font-mono">{l.unitPrice.toString()}</td>
                <td className="px-3 py-2 text-right font-mono">{l.gstRatePct.toString()}</td>
                <td className="px-3 py-2 text-right font-mono">{l.lineTotal.toString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-ik-paper-alt font-mono">
            <tr className="border-t border-ik-rule">
              <td colSpan={4} className="px-3 py-1.5 text-right text-ik-ink-3">Subtotal</td>
              <td className="px-3 py-1.5 text-right">{quote.subtotal.toString()}</td>
            </tr>
            <tr>
              <td colSpan={4} className="px-3 py-1.5 text-right text-ik-ink-3">Tax</td>
              <td className="px-3 py-1.5 text-right">{quote.taxTotal.toString()}</td>
            </tr>
            <tr className="border-t border-ik-rule font-semibold">
              <td colSpan={4} className="px-3 py-2 text-right">Grand total</td>
              <td className="px-3 py-2 text-right text-[15px]">{formatINR(quote.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {quote.notes && (
        <section className="mt-6 rounded-md border border-ik-rule bg-ik-paper-alt p-4">
          <h3 className="mb-1 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Notes</h3>
          <p className="whitespace-pre-wrap text-[12.5px] text-ik-ink-2">{quote.notes}</p>
        </section>
      )}

      <footer className="mt-8 border-t border-ik-rule pt-4 text-center text-[11.5px] text-ik-ink-3">
        Please reply to the email or call us to confirm. We can revise the menu, dates, or quantities
        any time before you accept.
      </footer>
    </div>
  );
}
