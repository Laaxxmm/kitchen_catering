import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { DeptJobStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { gateRolePage } from "@/server/rbac";
import { getHousekeepingJob } from "@/server/actions/housekeeping-jobs";
import {
  listHousekeepingItems,
  listHousekeepingStaff,
  listRooms,
} from "@/server/actions/housekeeping";
import { HK_JOB_TYPE_LABEL, JOB_PRIORITY_LABEL } from "@/lib/housekeeping-job-validators";
import { formatIST } from "@/lib/time";
import { JobActions } from "./_components/JobActions";

export const dynamic = "force-dynamic";

const WHEN = "dd MMM yyyy, HH:mm";

export default async function HousekeepingJobPage({ params }: { params: Promise<{ id: string }> }) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const { id } = await params;
  const job = await getHousekeepingJob(id);
  if (!job) notFound();
  const live = job.status === DeptJobStatus.OPEN || job.status === DeptJobStatus.IN_PROGRESS;

  const [rooms, staff, items] = live
    ? await Promise.all([
        listRooms({ activeOnly: true }),
        listHousekeepingStaff({ activeOnly: true }),
        listHousekeepingItems({ activeOnly: true }),
      ])
    : [[], [], []];

  const facts: Array<[string, ReactNode]> = [
    ["Type", HK_JOB_TYPE_LABEL[job.type]],
    ["Priority", JOB_PRIORITY_LABEL[job.priority]],
    ["Room", job.room ? `${job.room.number}${job.room.name ? ` — ${job.room.name}` : ""}` : "—"],
    ["Staff", job.staff?.name ?? "Unassigned"],
    ["Reported", `${formatIST(job.reportedAt, WHEN)} · ${job.reportedBy.name}`],
  ];
  if (job.startedAt) facts.push(["Started", formatIST(job.startedAt, WHEN)]);
  if (job.completedAt) facts.push(["Done", `${formatIST(job.completedAt, WHEN)} · ${job.closedBy?.name ?? "—"}`]);
  if (job.cancelledAt) facts.push(["Cancelled", `${formatIST(job.cancelledAt, WHEN)} · ${job.closedBy?.name ?? "—"}`]);

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping job"
        title={job.description}
        description={<StatusBadge status={job.status} />}
        actions={
          <Link href={`/housekeeping/jobs?status=${job.status}`}>
            <Button variant="outline" size="sm">← Jobs</Button>
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr,1.4fr]">
        <section className="grid content-start gap-3 rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card">
          <dl className="grid grid-cols-[110px,1fr] gap-x-3 gap-y-2 text-[12.5px]">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {job.notes && (
            <p className="whitespace-pre-line border-t border-ik-rule pt-3 text-[12.5px] text-ik-ink-2">{job.notes}</p>
          )}
          {job.outcome && (
            <div className="border-t border-ik-rule pt-3">
              <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                {job.status === DeptJobStatus.CANCELLED ? "Why cancelled" : "What was done"}
              </div>
              <p className="mt-1 whitespace-pre-line text-[12.5px]">{job.outcome}</p>
            </div>
          )}
          {job.issue && (
            <div className="border-t border-ik-rule pt-3">
              <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                Drawn from the store — issue to room {job.issue.room.number}, {job.issue.staff.name}
              </div>
              <ul className="mt-1 grid gap-0.5 text-[12.5px]">
                {job.issue.lines.map((l) => (
                  <li key={l.id}>
                    {l.item.name} — <span className="font-mono">{l.quantity.toString()} {l.item.unit}</span>
                    {l.reusable && <span className="text-ik-ink-3"> (out to room, comes back)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {live && (
          <JobActions
            job={{
              id: job.id,
              status: job.status,
              type: job.type,
              priority: job.priority,
              roomId: job.roomId,
              staffId: job.staffId,
              description: job.description,
              notes: job.notes,
            }}
            rooms={rooms.map((r) => ({ id: r.id, label: `${r.number}${r.name ? ` — ${r.name}` : ""}` }))}
            staff={staff.map((s) => ({ id: s.id, label: s.name }))}
            items={items.map((i) => ({
              id: i.id,
              name: i.name,
              unit: i.unit,
              reusable: i.reusable,
              currentStock: i.currentStock.toString(),
            }))}
          />
        )}
      </div>
    </>
  );
}
