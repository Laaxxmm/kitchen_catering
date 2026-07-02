import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import { computeOrderPnL } from "@/lib/pnl";

interface Props {
  orderId: string;
}

/**
 * Compact "is this order profitable?" panel for the order detail page.
 *
 * Server component — re-uses `computeOrderPnL` which already aggregates:
 *   - Revenue from the order's tax invoice (collected + outstanding)
 *   - Ingredient cost from every IngredientIssue tagged to the order
 *     (priced at the moving-average cost-at-issue moment, so the number
 *     reflects what the goods *actually* cost the kitchen)
 *   - Labour + overhead allocations
 *   - Gross profit + margin
 *
 * Only revenue / cost / profit / margin are shown here; for the full
 * variance breakdown (planned vs actual per ingredient) the user clicks
 * through to the dedicated P&L page.
 */
export async function OrderCostSummary({ orderId }: Props) {
  // The P&L rolls up recipes, issues, labour and invoices — a lot of moving
  // parts. If any of it trips, degrade to a small note rather than taking down
  // the whole order page.
  let pnl: Awaited<ReturnType<typeof computeOrderPnL>>;
  try {
    pnl = await computeOrderPnL(orderId);
  } catch (err) {
    console.error("OrderCostSummary: P&L failed", err);
    return (
      <div className="rounded-md border border-ik-rule bg-ik-card p-4 text-[12.5px] text-ik-ink-3">
        Cost &amp; profitability couldn&apos;t be computed for this order right now.
      </div>
    );
  }
  if (!pnl) return null;

  const revenue = pnl.revenue.invoiced.toNumber();
  const cost = pnl.totalCost.toNumber();
  const profit = pnl.grossProfit.toNumber();
  const margin = pnl.grossMarginPct.toNumber();
  const noData = revenue === 0 && cost === 0;

  const marginTone =
    margin >= 25 ? "text-positive" : margin >= 10 ? "text-ik-ink" : margin > 0 ? "text-amber" : "text-alert";
  const profitTone = profit > 0 ? "text-positive" : profit < 0 ? "text-alert" : "text-ik-ink";

  return (
    <section className="rounded-md border border-ik-rule bg-ik-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-medium text-[14px] text-ik-ink">Cost &amp; profitability</h3>
        <Link
          href={`/orders/${orderId}/pnl`}
          className="text-[11.5px] text-brand hover:underline"
        >
          Full P&amp;L →
        </Link>
      </div>

      {noData ? (
        <p className="text-[12.5px] text-ik-ink-3">
          No cost data yet. Stock issued to this order through the chef requisition flow will show up
          here automatically. You can also record additional stock used below.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi
            label="Revenue"
            value={formatINR(revenue.toFixed(2))}
            sub={`Collected ${formatINR(pnl.revenue.collected)}`}
          />
          <Kpi
            label="Ingredient cost"
            value={formatINR(pnl.ingredientCost.used)}
            sub={
              pnl.ingredientCost.recipe.gt(pnl.ingredientCost.actual)
                ? "Full recipe (incl. store stock)"
                : pnl.ingredientCost.actual.gt(0)
                  ? "Issued from store"
                  : undefined
            }
          />
          <Kpi label="Gross profit" value={formatINR(profit.toFixed(2))} valueClass={profitTone} />
          <Kpi
            label="Gross margin"
            value={`${pnl.grossMarginPct.toString()}%`}
            valueClass={marginTone}
          />
        </div>
      )}

      {pnl.ingredientCost.recipe.gt(pnl.ingredientCost.actual) && (
        <p className="mt-3 rounded-md border border-ik-rule bg-ik-paper-alt p-2.5 text-[11.5px] text-ik-ink-2">
          Ingredient cost is the <strong>full recipe cost</strong> of the dishes ({formatINR(pnl.ingredientCost.recipe)}),
          which counts ingredients used from existing store stock too — not just the
          {" "}{formatINR(pnl.ingredientCost.actual)} that was freshly issued for this order.
        </p>
      )}

      {pnl.ingredientCost.lines.length > 0 && (
        <details className="mt-4 text-[12.5px] text-ik-ink-2">
          <summary className="cursor-pointer text-ik-ink-3 hover:text-ik-ink">
            Issued from store ({pnl.ingredientCost.lines.length})
          </summary>
          <table className="mt-2 w-full border-t border-ik-rule">
            <thead className="border-b border-ik-rule text-left text-[11px] uppercase tracking-[0.08em] text-ik-ink-3">
              <tr>
                <th className="py-1 pr-2">Ingredient</th>
                <th className="py-1 pr-2 text-right">Used</th>
                <th className="py-1 pr-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {pnl.ingredientCost.lines.map((l, i) => (
                <tr key={i} className="border-b border-ik-rule last:border-b-0">
                  <td className="py-1 pr-2 font-ik-sans">{l.ingredient}</td>
                  <td className="py-1 pr-2 text-right">
                    {l.actual.qty.toString()} {l.unit}
                  </td>
                  <td className="py-1 pr-2 text-right">{formatINR(l.actual.cost)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 pr-2 font-medium font-ik-sans">Total</td>
                <td />
                <td className="py-1.5 pr-2 text-right font-medium">
                  {formatINR(pnl.ingredientCost.actual)}
                </td>
              </tr>
            </tbody>
          </table>
        </details>
      )}

      <div className="mt-4 border-t border-ik-rule pt-3 text-[12.5px] text-ik-ink-2">
        <p className="mb-2">
          Need to record stock used outside the chef requisition flow (e.g. last-minute extras)?
        </p>
        <Link href={`/inventory/issues/new?orderId=${orderId}`}>
          <Button size="sm" variant="outline">Record stock used</Button>
        </Link>
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="rounded border border-ik-rule p-2">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-ik-ink-3">{label}</div>
      <div className={"mt-0.5 font-mono text-[16px] " + (valueClass ?? "text-ik-ink")}>{value}</div>
      {sub && <div className="text-[10.5px] text-ik-ink-3">{sub}</div>}
    </div>
  );
}
