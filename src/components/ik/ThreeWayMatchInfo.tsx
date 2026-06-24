/**
 * Plain-English explainer for the 3-way match. Rendered as an expandable
 * <details> so it stays out of the way for people who already know it but
 * is one click away for anyone who doesn't. Reused on the vendor-bill form
 * (and anywhere else the match is referenced).
 */
export function ThreeWayMatchInfo() {
  return (
    <details className="rounded-[14px] border border-ik-rule bg-ik-paper-alt p-3 text-[12.5px] text-ik-ink-2 [&_summary]:cursor-pointer">
      <summary className="font-medium text-ik-ink">
        What is a 3-way match? <span className="text-ik-ink-3">(click to learn)</span>
      </summary>
      <div className="mt-2 grid gap-2">
        <p>
          Before a supplier&apos;s bill is paid, the system cross-checks{" "}
          <strong>three documents</strong> so you never pay for more than you ordered or received:
        </p>
        <ol className="grid gap-1.5 pl-1">
          <li>
            <span className="font-medium text-brand-700">1. Purchase Order (PO)</span> — what you
            agreed to buy, and at what price.
          </li>
          <li>
            <span className="font-medium text-brand-700">2. Goods Receipt (GRN)</span> — what
            actually arrived at the store when the supplier delivered.
          </li>
          <li>
            <span className="font-medium text-brand-700">3. This bill</span> — what the supplier is
            now charging you.
          </li>
        </ol>
        <p>
          When all three <strong>agree on quantity and price</strong>, the bill is safe to approve
          and pay. If they don&apos;t — say the supplier billed 25&nbsp;kg but only 20&nbsp;kg was
          received — the difference is flagged so it can be sorted out before any money goes out.
        </p>
      </div>
    </details>
  );
}
