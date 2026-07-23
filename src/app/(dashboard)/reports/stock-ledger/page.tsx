import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SummaryStrip } from "@/components/ik/StatChips";
import { gateRolePage } from "@/server/rbac";
import { getStockLedger, type LedgerStore } from "@/server/reports/stock-ledger";
import { formatINRWhole } from "@/lib/money";
import { formatIST, istMonthEnd, istMonthStart, istToUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STORES: { key: LedgerStore; label: string }[] = [
  { key: "kitchen", label: "Kitchen (incl. veg, frozen, non-veg)" },
  { key: "banquet", label: "Banquet / F&B" },
];

function qty(v: number) {
  // Trim trailing zeros on a 3dp quantity.
  return Number(v.toFixed(3)).toLocaleString("en-IN");
}

export default async function StockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; from?: string; to?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const sp = await searchParams;

  const store: LedgerStore = sp.store === "banquet" ? "banquet" : "kitchen";
  const now = new Date();
  const fromStr = sp.from && DATE_RE.test(sp.from) ? sp.from : formatIST(istMonthStart(now), "yyyy-MM-dd");
  const toStr = sp.to && DATE_RE.test(sp.to) ? sp.to : formatIST(istMonthEnd(now), "yyyy-MM-dd");
  const from = istToUtc(fromStr);
  const to = istToUtc(`${toStr}T23:59:59.999`);

  const { rows, totals } = await getStockLedger(store, from, to);
  const dl = `/api/export/stock-ledger?store=${store}&from=${fromStr}&to=${toStr}`;

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Stock ledger"
        description={`Per item — opening, in, out, adjustments and closing balance. ${fromStr} → ${toStr}.`}
        actions={
          <div className="flex gap-2">
            <a href={dl} download><Button>Download Excel</Button></a>
            <Link href="/reports"><Button variant="outline">Back</Button></Link>
          </div>
        }
      />

      {/* Store switch */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STORES.map((s) => (
          <Link
            key={s.key}
            href={`/reports/stock-ledger?store=${s.key}&from=${fromStr}&to=${toStr}`}
            className={
              "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition " +
              (store === s.key
                ? "bg-brand-500 text-white"
                : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
            }
          >
            {s.label}
          </Link>
        ))}
      </div>

      <form action="/reports/stock-ledger" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="store" value={store} />
        <div className="grid gap-1">
          <label htmlFor="from" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">From</label>
          <input id="from" type="date" name="from" defaultValue={fromStr} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="to" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">To</label>
          <input id="to" type="date" name="to" defaultValue={toStr} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      <div className="mb-5">
        <SummaryStrip
          chips={[
            { label: "Items moved", value: rows.length },
            { label: "Total in", value: qty(totals.inQty) },
            { label: "Total out", value: qty(totals.outQty), tone: "amber" },
            ...(store === "kitchen"
              ? [{ label: "Closing value", value: formatINRWhole(totals.value), tone: "green" as const }]
              : []),
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No stock movements in this range.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Adjust</TableHead>
                <TableHead className="text-right">Closing</TableHead>
                {store === "kitchen" && <TableHead className="text-right">Value</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.sku}-${r.name}`}>
                  <TableCell>
                    <div className="font-medium text-ik-ink">{r.name}</div>
                    <div className="font-mono text-[11px] text-ik-ink-3">{r.sku} · {r.unit}</div>
                  </TableCell>
                  <TableCell className="text-[12.5px] text-ik-ink-2">{r.category ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{qty(r.opening)}</TableCell>
                  <TableCell className="text-right tabular-nums text-positive">{r.inQty ? "+" + qty(r.inQty) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">{r.outQty ? "−" + qty(r.outQty) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.adjustQty ? qty(r.adjustQty) : "—"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{qty(r.closing)}</TableCell>
                  {store === "kitchen" && <TableCell className="text-right tabular-nums">{r.value != null ? formatINRWhole(r.value) : "—"}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
