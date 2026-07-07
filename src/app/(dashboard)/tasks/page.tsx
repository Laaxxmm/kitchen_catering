import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listTasks, myTaskCounts } from "@/server/actions/tasks";
import { TaskList } from "./_components/TaskList";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "PENDING", label: "Open" },
  { key: "SUBMITTED", label: "Awaiting review" },
  { key: "COMPLETED", label: "Completed" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
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

  const sp = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "PENDING") as Tab;

  const [tasks, counts] = await Promise.all([
    listTasks({ tab, from: sp.from, to: sp.to, scope: "MINE" }),
    myTaskCounts(),
  ]);

  const isAssigner = session.user.role === Role.ADMIN || session.user.role === Role.MANAGER;

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="My tasks"
        description="Tasks assigned to you. Open one to mark done with remarks."
        actions={
          isAssigner ? (
            <div className="flex gap-2">
              <Link href="/tasks/admin">
                <Button>Assign new task</Button>
              </Link>
              <Link href="/tasks/admin?tab=PENDING">
                <Button variant="outline" size="sm">Admin board →</Button>
              </Link>
            </div>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Open" value={counts.open} highlight={counts.open > 0} />
        <Stat label="Overdue" value={counts.overdue} alert={counts.overdue > 0} />
        <Stat label="Awaiting review" value={counts.submitted} />
        <Stat label="Completed" value={counts.completed} />
        <Stat label="Rejected" value={counts.rejected} alert={counts.rejected > 0} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((p) => {
          const active = tab === p.key;
          return (
            <Link
              key={p.key}
              href={`/tasks?tab=${p.key}`}
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

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/tasks">
        <input type="hidden" name="tab" value={tab} />
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
      </form>

      <TaskList tasks={tasks} showAssignee={false} emptyHint="Nothing here." />
    </>
  );
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
