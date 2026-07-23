import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { SummaryStrip, type StatChipDef } from "@/components/ik/StatChips";
import { gateRolePage } from "@/server/rbac";
import {
  adminTaskCounts,
  listAssignableUsers,
  listLongPendingTasks,
  listTasks,
  listTaskTemplates,
  myTaskCounts,
  type TaskTab,
} from "@/server/actions/tasks";
import { formatIST } from "@/lib/time";
import { roleLabel } from "@/lib/role-labels";
import { AssignTaskForm } from "../_components/AssignTaskForm";
import { TaskList } from "../_components/TaskList";

export const dynamic = "force-dynamic";

type View = "team" | "mine";

/** Status tabs, worded for whichever board is showing. */
const TABS: Record<View, { key: TaskTab; label: string }[]> = {
  team: [
    { key: "PENDING", label: "Assigned" },
    { key: "SUBMITTED", label: "Awaiting my review" },
    { key: "COMPLETED", label: "Completed" },
    { key: "REJECTED", label: "Rejected / cancelled" },
    { key: "ALL", label: "All" },
  ],
  mine: [
    { key: "PENDING", label: "Open" },
    { key: "SUBMITTED", label: "Awaiting review" },
    { key: "COMPLETED", label: "Completed" },
    { key: "REJECTED", label: "Rejected" },
    { key: "ALL", label: "All" },
  ],
};

export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    user?: string;
    from?: string;
    to?: string;
    view?: string;
  }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER]);

  const sp = await searchParams;
  const view: View = sp.view === "mine" ? "mine" : "team";
  const tabs = TABS[view];
  const tab: TaskTab = (tabs.find((t) => t.key === sp.tab)?.key as TaskTab | undefined) ?? "PENDING";

  const [tasks, users, templates] = await Promise.all([
    listTasks({
      tab,
      // "My tasks" narrows to work assigned to me; the user filter only
      // applies to the team board.
      assignedToId: view === "team" ? sp.user || undefined : undefined,
      from: sp.from || undefined,
      to: sp.to || undefined,
      scope: view === "mine" ? "MINE" : "ANY",
    }),
    listAssignableUsers(),
    listTaskTemplates({ activeOnly: false }),
  ]);

  // Stat strip + the long-pending alert differ per board.
  let chips: StatChipDef[];
  let longPending: Awaited<ReturnType<typeof listLongPendingTasks>> = [];
  let longPendingCount = 0;
  if (view === "mine") {
    const c = await myTaskCounts();
    chips = [
      { label: "Open", value: c.open, tone: c.open > 0 ? "green" : "grey" },
      { label: "Overdue", value: c.overdue, tone: c.overdue > 0 ? "red" : "grey" },
      { label: "Awaiting review", value: c.submitted },
      { label: "Completed", value: c.completed },
      { label: "Rejected", value: c.rejected, tone: c.rejected > 0 ? "red" : "grey" },
    ];
  } else {
    const [c, lp] = await Promise.all([adminTaskCounts(), listLongPendingTasks(6)]);
    longPending = lp;
    longPendingCount = c.longPending;
    chips = [
      { label: "Assigned", value: c.assigned },
      { label: "Awaiting review", value: c.submitted, tone: c.submitted > 0 ? "green" : "grey" },
      { label: "Completed", value: c.completed },
      { label: "Rejected", value: c.rejected, tone: c.rejected > 0 ? "red" : "grey" },
      { label: "Overdue", value: c.overdue, tone: c.overdue > 0 ? "red" : "grey" },
    ];
  }

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Admin"
        title="Tasks"
        description="Assign work to any team member, track submissions, and approve or reject. Switch to My tasks for work assigned to you."
        actions={
          <Link href="/tasks/admin/templates">
            <Button variant="outline" size="sm">Manage presets</Button>
          </Link>
        }
      />

      {/* Board switch — team-wide vs my own tasks */}
      <div className="mb-4 inline-flex rounded-xl border border-ik-rule bg-ik-paper-alt p-1">
        {(["team", "mine"] as View[]).map((v) => {
          const on = view === v;
          return (
            <Link
              key={v}
              href={`/tasks/admin?view=${v}`}
              className={
                "rounded-lg px-4 py-1.5 text-[13px] font-semibold transition " +
                (on ? "bg-ik-card text-ik-ink shadow-sm" : "text-ik-ink-3 hover:text-ik-ink")
              }
            >
              {v === "team" ? "Team tasks" : "My tasks"}
            </Link>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr,360px]">
        <div>
          <div className="mb-5">
            <SummaryStrip chips={chips} />
          </div>

          {view === "team" && longPending.length > 0 && (
            <div className="mb-5 rounded-2xl border border-alert/30 bg-alert-wash/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[12.5px] font-semibold text-alert">
                  Long-pending tasks ({longPendingCount})
                </div>
                <Link href="/tasks/admin?tab=PENDING" className="text-[11.5px] text-ik-ink-3 hover:text-brand">
                  View all →
                </Link>
              </div>
              <ul className="grid gap-1.5 text-[12.5px]">
                {longPending.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3">
                    <Link href={`/tasks/${t.id}`} className="truncate text-brand hover:underline">
                      {t.title}
                    </Link>
                    <span className="shrink-0 text-[11px] text-ik-ink-3">
                      {t.assignedTo.name} · {formatIST(t.assignedAt, "dd MMM")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Status tabs */}
          <div className="mb-4 flex flex-wrap gap-2">
            {tabs.map((p) => {
              const active = tab === p.key;
              return (
                <Link
                  key={p.key}
                  href={buildHref({ ...sp, view, tab: p.key })}
                  className={
                    "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition " +
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

          {/* Filters */}
          <form className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-ik-rule bg-ik-card p-3" action="/tasks/admin">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="view" value={view} />
            {view === "team" && (
              <div className="grid gap-1">
                <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">User</label>
                <select
                  name="user"
                  defaultValue={sp.user ?? ""}
                  className="h-9 min-w-[180px] rounded-lg border border-ik-rule bg-ik-card px-2 text-[12.5px]"
                >
                  <option value="">All users</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {roleLabel(u.role)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid gap-1">
              <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Target from</label>
              <input
                type="date"
                name="from"
                defaultValue={sp.from ?? ""}
                className="h-9 rounded-lg border border-ik-rule bg-ik-card px-2 text-[12.5px]"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Target to</label>
              <input
                type="date"
                name="to"
                defaultValue={sp.to ?? ""}
                className="h-9 rounded-lg border border-ik-rule bg-ik-card px-2 text-[12.5px]"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">Apply</Button>
            {(sp.user || sp.from || sp.to) && (
              <Link href={`/tasks/admin?view=${view}&tab=${tab}`} className="text-[12px] text-ik-ink-3 hover:text-brand">
                Clear
              </Link>
            )}
          </form>

          <TaskList tasks={tasks} showAssignee={view === "team"} emptyHint="No tasks match these filters." />
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <AssignTaskForm users={users} templates={templates} />
        </aside>
      </div>
    </>
  );
}

function buildHref(sp: { tab?: string; user?: string; from?: string; to?: string; view?: string }) {
  const params = new URLSearchParams();
  if (sp.view) params.set("view", sp.view);
  if (sp.tab) params.set("tab", sp.tab);
  if (sp.user) params.set("user", sp.user);
  if (sp.from) params.set("from", sp.from);
  if (sp.to) params.set("to", sp.to);
  const q = params.toString();
  return `/tasks/admin${q ? `?${q}` : ""}`;
}
