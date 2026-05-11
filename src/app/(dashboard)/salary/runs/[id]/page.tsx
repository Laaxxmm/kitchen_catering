import Link from "next/link";
import { notFound } from "next/navigation";
import { Role, SalaryRunStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { approveSalaryRun, getSalaryRun, postSalaryRun } from "@/server/actions/salary";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SalaryRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [run, session] = await Promise.all([getSalaryRun(id), auth()]);
  if (!run) notFound();
  const role = session?.user?.role;
  const canApprove = run.status === SalaryRunStatus.DRAFT && (role === Role.ADMIN || role === Role.MANAGER);
  const canPost = run.status === SalaryRunStatus.APPROVED && (role === Role.ADMIN || role === Role.MANAGER);

  async function doApprove() { "use server"; await approveSalaryRun(id); }
  async function doPost() { "use server"; await postSalaryRun(id); }

  return (
    <>
      <PageHeader
        eyebrow="Finance · Salary"
        title={run.runNo}
        description={`Period ${formatIST(run.periodMonth, "MMMM yyyy")} · ${run.lines.length} employees · ${formatINR(run.totalAmount)}`}
        actions={
          <div className="flex gap-2">
            <Link href="/salary/runs"><Button variant="outline">Back</Button></Link>
            {canApprove && <form action={doApprove}><Button type="submit">Approve</Button></form>}
            {canPost && <form action={doPost}><Button type="submit">Post</Button></form>}
          </div>
        }
      />
      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <StatusBadge status={run.status} />
        <span className="text-ik-ink-3">Created by {run.createdBy.name}</span>
        {run.approvedAt && <span className="text-ik-ink-3">· Approved {formatIST(run.approvedAt)} by {run.approvedBy?.name}</span>}
        {run.postedAt && <span className="text-positive">· Posted {formatIST(run.postedAt)}</span>}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead className="text-right">Hours</TableHead>
            <TableHead className="text-right">Hourly rate</TableHead>
            <TableHead className="text-right">Monthly base</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Deductions</TableHead>
            <TableHead className="text-right">Net pay</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {run.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>{l.employeeName}</TableCell>
              <TableCell className="text-right font-mono">{l.hoursWorked?.toString() ?? "—"}</TableCell>
              <TableCell className="text-right font-mono">{l.hourlyRate?.toString() ?? "—"}</TableCell>
              <TableCell className="text-right font-mono">{l.monthlyBase?.toString() ?? "—"}</TableCell>
              <TableCell className="text-right font-mono">{formatINR(l.grossPay)}</TableCell>
              <TableCell className="text-right font-mono">{l.deductions.toString()}</TableCell>
              <TableCell className="text-right font-mono font-medium">{formatINR(l.netPay)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
