import Link from "next/link";
import { DeptJobStatus, JobPriority, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { gateRolePage } from "@/server/rbac";
import { listHousekeepingJobs } from "@/server/actions/housekeeping-jobs";
import { listHousekeepingStaff, listRooms } from "@/server/actions/housekeeping";
import { HK_JOB_TYPE_LABEL, JOB_PRIORITY_LABEL } from "@/lib/housekeeping-job-validators";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

const TABS: { status: DeptJobStatus; label: string }[] = [
  { status: DeptJobStatus.OPEN, label: "Open" },
  { status: DeptJobStatus.IN_PROGRESS, label: "In progress" },
  { status: DeptJobStatus.DONE, label: "Done" },
  { status: DeptJobStatus.CANCELLED, label: "Cancelled" },
];

const PRIORITY_TONE: Record<JobPriority, string> = {
  LOW: "text-ik-ink-3",
  NORMAL: "text-ik-ink-2",
  HIGH: "text-amber",
  URGENT: "font-medium text-alert",
};

/** Report → close (or → now while live), in the unit that reads best. */
function age(from: Date, to: Date): string {
  const mins = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

export default async function HousekeepingJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; room?: string; staff?: string; from?: string; to?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const sp = await searchParams;
  const status = TABS.find((t) => t.status === sp.status)?.status ?? DeptJobStatus.OPEN;

  const [jobs, rooms, staff] = await Promise.all([
    listHousekeepingJobs({
      status,
      roomId: sp.room || undefined,
      staffId: sp.staff || undefined,
      from: sp.from || undefined,
      to: sp.to || undefined,
    }),
    listRooms({ activeOnly: false }),
    listHousekeepingStaff({ activeOnly: false }),
  ]);
  const now = new Date();
  const filtered = !!(sp.room || sp.staff || sp.from || sp.to);

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Jobs"
        description="The department's own work — open it, do it, close it with what was used. Items used come out of the housekeeping store."
        actions={
          <div className="flex gap-2">
            <Link href="/housekeeping/jobs/new"><Button>+ New job</Button></Link>
            <Link href="/housekeeping"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />

      <nav className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={`/housekeeping/jobs?status=${t.status}`}
            className={
              "rounded-full px-3 py-1 text-[12px] " +
              (status === t.status
                ? "bg-brand-500 text-white"
                : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/housekeeping/jobs">
        <input type="hidden" name="status" value={status} />
        <div className="grid gap-1">
          <label htmlFor="f-from" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Reported from</label>
          <input id="f-from" type="date" name="from" defaultValue={sp.from ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="f-to" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">To</label>
          <input id="f-to" type="date" name="to" defaultValue={sp.to ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="f-room" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Room</label>
          <select id="f-room" name="room" defaultValue={sp.room ?? ""} className="h-9 min-w-[140px] rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]">
            <option value="">All rooms</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.number}{r.name ? ` — ${r.name}` : ""}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="f-staff" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Staff</label>
          <select id="f-staff" name="staff" defaultValue={sp.staff ?? ""} className="h-9 min-w-[140px] rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]">
            <option value="">All staff</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
        {filtered && (
          <Link href={`/housekeeping/jobs?status=${status}`} className="text-[12px] text-ik-ink-3 hover:text-brand">Clear</Link>
        )}
      </form>

      {jobs.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          No {TABS.find((t) => t.status === status)!.label.toLowerCase()} jobs{filtered ? " match these filters" : ""}.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Room</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Reported</TableHead>
              <TableHead className="text-right">
                {status === DeptJobStatus.DONE ? "Took" : status === DeptJobStatus.CANCELLED ? "Open for" : "Age"}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((j) => (
              <TableRow key={j.id}>
                <TableCell>
                  {j.room ? (
                    <>
                      <span className="font-mono text-[12.5px]">{j.room.number}</span>
                      {j.room.name && <div className="text-[11px] text-ik-ink-3">{j.room.name}</div>}
                    </>
                  ) : (
                    <span className="text-ik-ink-3">—</span>
                  )}
                </TableCell>
                <TableCell className="text-[12px]">{HK_JOB_TYPE_LABEL[j.type]}</TableCell>
                <TableCell className="max-w-[320px] text-[12.5px]">
                  <Link href={`/housekeeping/jobs/${j.id}`} className="font-medium text-ik-ink hover:text-brand hover:underline">
                    {j.description}
                  </Link>
                  {j.issue && <div className="text-[11px] text-ik-ink-3">Items drawn</div>}
                </TableCell>
                <TableCell className={"text-[12px] " + PRIORITY_TONE[j.priority]}>{JOB_PRIORITY_LABEL[j.priority]}</TableCell>
                <TableCell className="text-[12.5px]">
                  {j.staff?.name ?? <span className="text-ik-ink-3">Unassigned</span>}
                </TableCell>
                <TableCell className="font-mono text-[12px]">
                  {formatIST(j.reportedAt, "dd MMM, HH:mm")}
                  <div className="font-sans text-[11px] text-ik-ink-3">{j.reportedBy.name}</div>
                </TableCell>
                <TableCell className="text-right font-mono text-[12px]">
                  {age(j.reportedAt, j.completedAt ?? j.cancelledAt ?? now)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
