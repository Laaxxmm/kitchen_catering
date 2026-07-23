import Link from "next/link";
import { notFound } from "next/navigation";
import { Role, TaskStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { gateRolePage } from "@/server/rbac";
import { getTaskById } from "@/server/actions/tasks";
import { formatIST } from "@/lib/time";
import { roleLabel } from "@/lib/role-labels";
import { SubmitTaskForm } from "../_components/SubmitTaskForm";
import { ReviewControls } from "../_components/ReviewControls";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await gateRolePage([
    Role.ADMIN,
    Role.MANAGER,
    Role.SALES,
    Role.STORE_KEEPER,
    Role.KITCHEN_HEAD,
    Role.FNB_SERVICE,
    Role.DELIVERY,
    Role.ACCOUNTS,
    Role.HOUSEKEEPING_MANAGER,
    Role.MAINTENANCE_MANAGER,
  ]);

  const { id } = await params;
  const task = await getTaskById(id);
  if (!task) notFound();

  const role = session.user.role;
  const isAssigner = role === Role.ADMIN || role === Role.MANAGER;
  const isAssignee = task.assignedToId === session.user.id;
  const overdue =
    (task.status === TaskStatus.ASSIGNED || task.status === TaskStatus.REJECTED) &&
    task.targetDate.getTime() < Date.now();

  return (
    <>
      <PageHeader
        eyebrow="Task"
        title={task.title}
        description={
          <span>
            Assigned by{" "}
            <span className="font-medium text-ik-ink">{task.assignedBy.name}</span>{" "}
            to <span className="font-medium text-ik-ink">{task.assignedTo.name}</span>
          </span>
        }
        actions={
          <Link
            href={isAssigner ? "/tasks/admin" : "/tasks"}
            className="text-[12px] text-ik-ink-3 hover:text-brand"
          >
            ← Back
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr,320px]">
        <div className="grid gap-4">
          <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <div className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                  Status
                </div>
                <div className="mt-1">
                  <StatusBadge status={task.status} />
                </div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                  Priority
                </div>
                <div className="mt-1 text-[13px]">{task.priority.toLowerCase()}</div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                  Assigned
                </div>
                <div className="mt-1 font-mono text-[12px]">
                  {formatIST(task.assignedAt, "dd MMM, HH:mm")}
                </div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                  Target
                </div>
                <div
                  className={
                    "mt-1 font-mono text-[12px] " +
                    (overdue ? "text-alert" : "text-ik-ink")
                  }
                >
                  {formatIST(task.targetDate, "dd MMM, HH:mm")}
                  {overdue && " · overdue"}
                </div>
              </div>
            </div>

            {task.description && (
              <div className="mt-4 border-t border-ik-rule pt-4">
                <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                  Details
                </div>
                <p className="mt-1 whitespace-pre-line text-[13px] text-ik-ink-2">
                  {task.description}
                </p>
              </div>
            )}
          </section>

          {task.status === TaskStatus.REJECTED && task.rejectionReason && (
            <section className="rounded-md border border-alert/30 bg-alert/5 p-4">
              <div className="text-[12px] font-medium text-alert">Rejected</div>
              {task.reviewedAt && (
                <div className="mt-0.5 text-[11px] text-ik-ink-3">
                  by {task.reviewedBy?.name} on{" "}
                  {formatIST(task.reviewedAt, "dd MMM, HH:mm")}
                </div>
              )}
              <p className="mt-2 whitespace-pre-line text-[13px] text-ik-ink-2">
                {task.rejectionReason}
              </p>
            </section>
          )}

          {(task.status === TaskStatus.SUBMITTED ||
            task.status === TaskStatus.COMPLETED) &&
            task.completionRemarks && (
              <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
                <div className="text-[12px] font-medium text-ik-ink-2">
                  Assignee remarks
                </div>
                {task.completedAt && (
                  <div className="mt-0.5 text-[11px] text-ik-ink-3">
                    Done at{" "}
                    <span className="font-mono">
                      {formatIST(task.completedAt, "dd MMM, HH:mm")}
                    </span>
                    {task.submittedAt && (
                      <>
                        {" · submitted "}
                        <span className="font-mono">
                          {formatIST(task.submittedAt, "dd MMM, HH:mm")}
                        </span>
                      </>
                    )}
                  </div>
                )}
                <p className="mt-2 whitespace-pre-line text-[13px] text-ik-ink-2">
                  {task.completionRemarks}
                </p>
                {task.status === TaskStatus.COMPLETED && task.reviewedAt && (
                  <div className="mt-3 border-t border-ik-rule pt-2 text-[11px] text-ik-ink-3">
                    Approved by {task.reviewedBy?.name} on{" "}
                    {formatIST(task.reviewedAt, "dd MMM, HH:mm")}
                  </div>
                )}
              </section>
            )}

          {/* Submit form — assignee, while task is open or rejected. */}
          {isAssignee &&
            (task.status === TaskStatus.ASSIGNED ||
              task.status === TaskStatus.REJECTED) && (
              <SubmitTaskForm
                taskId={task.id}
                rejected={task.status === TaskStatus.REJECTED}
              />
            )}

          {/* Review form — assigner, when submitted; cancel ability otherwise. */}
          {isAssigner &&
            (task.status === TaskStatus.SUBMITTED ||
              task.status === TaskStatus.ASSIGNED ||
              task.status === TaskStatus.REJECTED) && (
              <ReviewControls taskId={task.id} status={task.status} />
            )}
        </div>

        <aside className="grid gap-3 text-[12.5px]">
          <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
              Assignee
            </div>
            <div className="mt-1 font-medium">{task.assignedTo.name}</div>
            <div className="text-[11px] text-ik-ink-3">
              {roleLabel(task.assignedTo.role)} · {task.assignedTo.email}
            </div>
          </div>
          <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
              Assigned by
            </div>
            <div className="mt-1 font-medium">{task.assignedBy.name}</div>
            <div className="text-[11px] text-ik-ink-3">{roleLabel(task.assignedBy.role)}</div>
          </div>
          {task.template && (
            <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
              <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                From preset
              </div>
              <div className="mt-1">{task.template.title}</div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
