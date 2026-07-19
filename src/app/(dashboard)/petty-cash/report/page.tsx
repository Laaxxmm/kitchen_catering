import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SummaryStrip } from "@/components/ik/StatChips";
import { gateRolePage } from "@/server/rbac";
import { getPettyCashReport, type PettyCashMovementKind } from "@/server/actions/petty-cash";
import { formatINR, formatINRWhole, toDecimal } from "@/lib/money";
import { formatIST, istMonthEnd, istMonthStart, istToUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const KIND_LABEL: Record<PettyCashMovementKind, string> = {
  VOUCHER_OUT: "Voucher out",
  TOPUP_IN: "Top-up in",
  REVERSAL_IN: "Reversal in",
};

export default async function PettyCashReportPage({
  searchParams,
}: {
  searchParams: Promise<{ float?: string; from?: string; to?: string }>;
}) {
  // Same read roles as the /petty-cash middleware rule.
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const sp = await searchParams;

  // Default range: current month (IST). Malformed params fall back too.
  const now = new Date();
  const fromStr = sp.from && DATE_RE.test(sp.from) ? sp.from : formatIST(istMonthStart(now), "yyyy-MM-dd");
  const toStr = sp.to && DATE_RE.test(sp.to) ? sp.to : formatIST(istMonthEnd(now), "yyyy-MM-dd");
  const from = istToUtc(fromStr);
  const to = istToUtc(`${toStr}T23:59:59.999`);
  const floatId = sp.float || undefined;

  const report = await getPettyCashReport({ floatId, from, to });
  const selectedFloat = report.floats.find((f) => f.id === floatId);
  const net = toDecimal(report.totals.net);

  return (
    <>
      <PageHeader
        eyebrow="Petty cash"
        title="Report"
        description={`Movements ${fromStr} → ${toStr}${selectedFloat ? ` · ${selectedFloat.name}` : " · all floats"}.`}
        actions={
          <div className="flex gap-2">
            <a
              href={`/api/petty-cash/report/pdf?from=${fromStr}&to=${toStr}${floatId ? `&float=${floatId}` : ""}`}
              target="_blank"
              rel="noopener"
            >
              <Button>Download PDF</Button>
            </a>
            <Link href="/petty-cash"><Button variant="outline">Back</Button></Link>
          </div>
        }
      />

      <form action="/petty-cash/report" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="float" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Float</label>
          <select
            id="float"
            name="float"
            defaultValue={floatId ?? ""}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]"
          >
            <option value="">All floats</option>
            {report.floats.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
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
            { label: "Cash out", value: formatINRWhole(report.totals.cashOut), tone: "amber" },
            { label: "Cash in (top-ups + reversals)", value: formatINRWhole(report.totals.cashIn), tone: "green" },
            { label: "Net for range", value: `${net.lt(0) ? "−" : "+"}${formatINRWhole(net.abs())}`, tone: net.lt(0) ? "red" : "green" },
          ]}
        />
      </div>

      {report.movements.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No movements in this range.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Float</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Voucher / Ref</TableHead>
              <TableHead>Category / Source</TableHead>
              <TableHead>Paid to</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.movements.map((m) => {
              const amt = toDecimal(m.amount);
              const out = amt.lt(0);
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-[12px]">{formatIST(m.date, "yyyy-MM-dd")}</TableCell>
                  <TableCell className="text-[12.5px]">{m.floatName}</TableCell>
                  <TableCell className="text-[12.5px]">{KIND_LABEL[m.kind]}</TableCell>
                  <TableCell className="font-mono text-[12px]">{m.refNo ?? "—"}</TableCell>
                  <TableCell className="text-[12.5px]">{m.detail}</TableCell>
                  <TableCell className="text-[12.5px]">{m.paidTo ?? "—"}</TableCell>
                  <TableCell className={"text-right font-mono " + (out ? "text-red-700" : "text-emerald-700")}>
                    {out ? "−" : "+"}
                    {formatINR(amt.abs())}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <section className="mt-6">
        <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Float balances (now)</h3>
        <div className="flex flex-wrap gap-2">
          {(selectedFloat ? [selectedFloat] : report.floats).map((f) => (
            <div key={f.id} className="rounded-md border border-ik-rule bg-ik-card px-3 py-2">
              <div className="text-[11px] text-ik-ink-3">
                <Link href={`/petty-cash/floats/${f.id}`} className="hover:underline">{f.name}</Link>
              </div>
              <div className={"font-mono text-[14px] " + (toDecimal(f.currentBalance).lt(0) ? "font-medium text-alert" : "text-ik-ink")}>{formatINR(f.currentBalance)}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
