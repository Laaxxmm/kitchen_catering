import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeOrderPnL } from "@/lib/pnl";
import { formatINR } from "@/lib/money";
import { requireSession } from "@/server/rbac";

export const dynamic = "force-dynamic";

function KPI({ label, value, tone, sub }: { label: string; value: string; tone?: "positive" | "alert" | "neutral"; sub?: string }) {
  const colour = tone === "positive" ? "text-positive" : tone === "alert" ? "text-alert" : "text-ik-ink";
  return (
    <div className="rounded-md border border-ik-rule bg-ik-card p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{label}</div>
      <div className={`mt-1 font-mono text-[22px] ${colour}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-ik-ink-3">{sub}</div>}
    </div>
  );
}

export default async function OrderPnLPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const pnl = await computeOrderPnL(id);
  if (!pnl) notFound();

  const margin = pnl.grossMarginPct.toNumber();
  const marginTone = margin >= 25 ? "positive" : margin >= 10 ? "neutral" : "alert";

  return (
    <>
      <PageHeader
        eyebrow={`P&L · ${pnl.orderCode}`}
        title={`${pnl.customerName}`}
        description={`Status ${pnl.status} · Revenue ${formatINR(pnl.revenue.invoiced)} · Margin ${pnl.grossMarginPct.toString()}%`}
        actions={<Link href={`/orders/${id}`}><Button variant="outline">Back to order</Button></Link>}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <KPI label="Revenue (invoiced)" value={formatINR(pnl.revenue.invoiced)} sub={`Collected ${formatINR(pnl.revenue.collected)}`} />
        <KPI label="Total cost" value={formatINR(pnl.totalCost)} />
        <KPI label="Gross profit" value={formatINR(pnl.grossProfit)} tone={pnl.grossProfit.gt(0) ? "positive" : "alert"} />
        <KPI label="Gross margin" value={`${pnl.grossMarginPct.toString()}%`} tone={marginTone} />
      </div>

      <section className="mb-6 rounded-md border border-ik-rule bg-ik-card p-4">
        <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Cost composition</h3>
        {(() => {
          const total = pnl.totalCost.toNumber();
          if (total <= 0) return <p className="text-[12.5px] text-ik-ink-3">No costs recorded yet.</p>;
          const segs = [
            { label: "Ingredients (actual)", value: pnl.ingredientCost.actual.toNumber(), colour: "bg-brand-500" },
            { label: "Labour", value: pnl.labourCost.toNumber(), colour: "bg-amber" },
            { label: "Overhead", value: pnl.overheadCost.toNumber(), colour: "bg-info" },
          ];
          return (
            <>
              <div className="flex h-6 w-full overflow-hidden rounded-md bg-ik-paper-alt">
                {segs.map((s) => (
                  <div key={s.label} className={s.colour} style={{ width: `${(s.value / total) * 100}%` }} />
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {segs.map((s) => (
                  <div key={s.label} className="rounded border border-ik-rule p-2 text-[12.5px]">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-3 w-3 rounded-sm ${s.colour}`} />
                      <span className="font-medium">{s.label}</span>
                    </div>
                    <div className="mt-1 font-mono">{formatINR(s.value)} · {((s.value / total) * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </section>

      <section className="mb-6">
        <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Ingredient variance (planned vs actual)</h3>
        {pnl.ingredientCost.lines.length === 0 ? (
          <p className="text-[12.5px] text-ik-ink-3">No ingredient activity yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead className="text-right">Planned qty</TableHead>
                <TableHead className="text-right">Actual qty</TableHead>
                <TableHead className="text-right">Planned ₹</TableHead>
                <TableHead className="text-right">Actual ₹</TableHead>
                <TableHead className="text-right">Variance ₹</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pnl.ingredientCost.lines.map((l, idx) => {
                const variance = l.variance.toNumber();
                const cls = variance > 0 ? "text-alert" : variance < 0 ? "text-positive" : "";
                return (
                  <TableRow key={idx}>
                    <TableCell>{l.ingredient}</TableCell>
                    <TableCell className="text-right font-mono">{l.planned.qty.toString()} {l.unit}</TableCell>
                    <TableCell className="text-right font-mono">{l.actual.qty.toString()} {l.unit}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(l.planned.cost)}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(l.actual.cost)}</TableCell>
                    <TableCell className={`text-right font-mono ${cls}`}>{formatINR(l.variance)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell className="font-medium">Totals</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-mono font-medium">{formatINR(pnl.ingredientCost.planned)}</TableCell>
                <TableCell className="text-right font-mono font-medium">{formatINR(pnl.ingredientCost.actual)}</TableCell>
                <TableCell className={`text-right font-mono font-medium ${pnl.ingredientCost.variance.gt(0) ? "text-alert" : "text-positive"}`}>
                  {formatINR(pnl.ingredientCost.variance)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
