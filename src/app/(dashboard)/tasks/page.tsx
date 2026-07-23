import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { SummaryStrip } from "@/components/ik/StatChips";
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

  // Assigners land on the admin board (which now carries a "My tasks" tab),
  // so clicking Tasks in the nav opens the powerful board, not an empty
  // personal list. Everyone else stays on their own tasks.
  if (session.user.role === Role.ADMIN || session.user.role === Role.MANAGER) {
    redirect("/tasks/admin");
  }

  const sp = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "PENDING") as Tab;

  const [tasks, counts] = await Promise.all([
    listTasks({ tab, from: sp.from, to: sp.to, scope: "MINE" }),
    myTaskCounts(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="My tasks"
        description="Tasks assigned to you. Open one to mark done with remarks."
      />

      <div className="mb-4">
        <SummaryStrip
          chips={[
            { label: "Open", value: counts.open, tone: counts.open > 0 ? "green" : "grey" },
            { label: "Overdue", value: counts.overdue, tone: counts.overdue > 0 ? "red" : "grey" },
            { label: "Awaiting review", value: counts.submitted },
            { label: "Completed", value: counts.completed },
            { label: "Rejected", value: counts.rejected, tone: counts.rejected > 0 ? "red" : "grey" },
          ]}
        />
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
