import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import {
  adminTaskCounts,
  listAssignableUsers,
  listLongPendingTasks,
  listTasks,
  listTaskTemplates,
  type TaskTab,
} from "@/server/actions/tasks";
import { formatIST } from "@/lib/time";
import { AssignTaskForm } from "../_components/AssignTaskForm";
import { TaskList } from "../_components/TaskList";

export const dynamic = "force-dynamic";

const TABS: { key: TaskTab; label: string }[] = [
  { key: "PENDING", label: "Assigned" },
  { key: "SUBMITTED", label: "Awaiting my review" },
  { key: "COMPLETED", label: "Completed" },
  { key: "REJECTED", label: "Rejected / cancelled" },
  { key: "ALL", label: "All" },
];

export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    user?: string;
    from?: string;
    to?: string;
  }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER]);

  const sp = await searchParams;
  const tab: TaskTab =
    (TABS.find((t) => t.key === sp.tab)?.key as TaskTab | undefined) ?? "PENDING";

  const [tasks, counts, users, templates, longPending] = await Promise.all([
    listTasks({
      tab,
      assignedToId: sp.user || undefined,
      from: sp.from || undefined,
      to: sp.to || undefined,
      scope: "ANY",
    }),
    adminTaskCounts(),
    listAssignableUsers(),
    listTaskTemplates({ activeOnly: false }),
    listLongPendingTasks(6),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Admin"
        title="Tasks"
        description="Assign tasks to any team member. Track submissions, approve or reject. Long-pending items surface in the notification card below."
        actions={
          <Link href="/tasks/admin/templates">
            <Button variant="outline" size="sm">Manage presets</Button>
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr,360px]">
        <div>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            <Stat label="Assigned" value={counts.assigned} />
            <Stat
              label="Awaiting review"
              value={counts.submitted}
              highlight={counts.submitted > 0}
            />
            <Stat label="Completed" value={counts.completed} />
            <Stat label="Rejected" value={counts.rejected} alert={counts.rejected > 0} />
            <Stat label="Overdue" value={counts.overdue} alert={counts.overdue > 0} />
          </div>

          {longPending.length > 0 && (
            <div className="mb-5 rounded-md border border-alert/30 bg-alert/5 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[12px] font-medium text-alert">
                  Long-pending tasks ({counts.longPending})
                </div>
                <Link
                  href="/tasks/admin?tab=PENDING"
                  className="text-[11px] text-ik-ink-3 hover:text-brand"
                >
                  View all →
                </Link>
              </div>
              <ul className="grid gap-1.5 text-[12.5px]">
                {longPending.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="truncate text-brand hover:underline"
                    >
                      {t.title}
                    </Link>
                    <span className="shrink-0 text-[11px] text-ik-ink-3">
                      {t.assignedTo.name} ·{" "}
                      <span className="font-mono">
                        {formatIST(t.assignedAt, "dd MMM")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            {TABS.map((p) => {
              const active = tab === p.key;
              return (
                <Link
                  key={p.key}
                  href={buildHref({ ...sp, tab: p.key })}
                  className={
                    "rounded-full px-3 py-1 text-[12px] " +
                    (active
                      ? "bg-brand-500 text-white"
                      : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
                  }
                >
                  {p.label}
                </Link>
              );
            })}
          </div>

          <form className="mb-4 flex flex-wrap items-end gap-2" action="/tasks/admin">
            <input type="hidden" name="tab" value={tab} />
            <div className="grid gap-1">
              <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                User
              </label>
              <select
                name="user"
                defaultValue={sp.user ?? ""}
                className="h-9 min-w-[180px] rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]"
              >
                <option value="">All users</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.role}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                Target from
              </label>
              <input
                type="date"
                name="from"
                defaultValue={sp.from ?? ""}
                className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                Target to
              </label>
              <input
                type="date"
                name="to"
                defaultValue={sp.to ?? ""}
                className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">Apply</Button>
            {(sp.user || sp.from || sp.to) && (
              <Link
                href={`/tasks/admin?tab=${tab}`}
                className="text-[12px] text-ik-ink-3 hover:text-brand"
              >
                Clear
              </Link>
            )}
          </form>

          <TaskList tasks={tasks} emptyHint="No tasks match these filters." />
        </div>

        <aside>
          <AssignTaskForm users={users} templates={templates} />
        </aside>
      </div>
    </>
  );
}

function buildHref(sp: { tab?: string; user?: string; from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (sp.tab) params.set("tab", sp.tab);
  if (sp.user) params.set("user", sp.user);
  if (sp.from) params.set("from", sp.from);
  if (sp.to) params.set("to", sp.to);
  const q = params.toString();
  return `/tasks/admin${q ? `?${q}` : ""}`;
}

function Stat({
  label,
  value,
  highlight,
  alert,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  alert?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border p-3 " +
        (alert
          ? "border-alert/30 bg-alert/5"
          : highlight
            ? "border-brand-200 bg-brand-50"
            : "border-ik-rule bg-ik-card")
      }
    >
      <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{label}</div>
      <div
        className={
          "mt-1 font-mono text-[20px] " +
          (alert ? "text-alert" : highlight ? "text-brand-700" : "text-ik-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}
