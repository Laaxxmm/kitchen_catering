import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listSalaryRuns } from "@/server/actions/salary";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SalaryRunsPage() {
  const runs = await listSalaryRuns();
  return (
    <>
      <PageHeader
        eyebrow="Finance · Salary"
        title="Salary runs"
        description="One run per calendar month. HOURLY: gross = approved-time-entry hours × rate. SALARIED: gross = monthly base. Deductions deferred to Zoho Payroll integration."
        actions={<Link href="/salary/runs/new"><Button>New run</Button></Link>}
      />
      <div className="mb-6 flex gap-2 text-[12.5px]">
        <Link href="/salary/runs" className="rounded-full bg-brand-500 px-3 py-1 text-white">Runs</Link>
        <Link href="/salary/structures" className="rounded-full bg-ik-paper-alt px-3 py-1">Structures</Link>
      </div>
      {runs.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No runs yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run no</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Created by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Link href={`/salary/runs/${r.id}`} className="font-mono text-brand hover:underline">{r.runNo}</Link></TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(r.periodMonth, "yyyy-MM")}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="text-right">{r._count.lines}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(r.totalAmount)}</TableCell>
                <TableCell>{r.createdBy?.name ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
