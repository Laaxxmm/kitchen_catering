import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPettyCashFloats } from "@/server/actions/petty-cash";
import { toDecimal, formatINR, formatINRWhole } from "@/lib/money";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill } from "@/components/ik/StatusPill";

export const dynamic = "force-dynamic";

// A float is "low" once it drops below a quarter of its opening balance —
// a rough heuristic (no per-float threshold field exists yet).
function isLow(opening: string, current: string) {
  const o = toDecimal(opening);
  const c = toDecimal(current);
  return o.gt(0) && c.lt(o.times(0.25));
}

export default async function PettyCashPage() {
  const floats = await listPettyCashFloats();
  const totalCurrent = floats.reduce((s, f) => s.plus(toDecimal(f.currentBalance)), toDecimal(0));
  const lowCount = floats.filter((f) => isLow(f.openingBalance.toString(), f.currentBalance.toString())).length;

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Petty cash"
        description="Float ledger. Balance updates atomically with every voucher / top-up."
        actions={
          <div className="flex gap-2">
            <Link href="/petty-cash/report"><Button variant="outline">Report</Button></Link>
            <Link href="/petty-cash/new"><Button>New float</Button></Link>
          </div>
        }
      />

      {floats.length > 0 && (
        <div className="mb-5">
          <SummaryStrip
            chips={[
              { label: "Cash on hand", value: formatINRWhole(totalCurrent), tone: "ink" },
              { label: "Floats", value: floats.length, tone: "ink" },
              { label: "Low floats", value: lowCount, tone: lowCount > 0 ? "amber" : "grey" },
            ]}
          />
        </div>
      )}

      {floats.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No floats yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Custodian</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Vouchers</TableHead>
              <TableHead className="text-right">Top-ups</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {floats.map((f) => {
              const low = isLow(f.openingBalance.toString(), f.currentBalance.toString());
              const negative = toDecimal(f.currentBalance).lt(0);
              return (
                <TableRow key={f.id}>
                  <TableCell>
                    <Link href={`/petty-cash/floats/${f.id}`} className="text-brand hover:underline">{f.name}</Link>
                    {low && <span className="ml-2"><StatusPill tone="amber">low float</StatusPill></span>}
                  </TableCell>
                  <TableCell>{f.custodian.name}</TableCell>
                  <TableCell className="text-right font-mono text-ik-ink-3">{formatINR(f.openingBalance)}</TableCell>
                  <TableCell className={"text-right font-mono " + (negative ? "font-medium text-alert" : low ? "text-amber-700" : "")}>{formatINR(f.currentBalance)}</TableCell>
                  <TableCell className="text-right">{f._count.vouchers}</TableCell>
                  <TableCell className="text-right">{f._count.topUps}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
