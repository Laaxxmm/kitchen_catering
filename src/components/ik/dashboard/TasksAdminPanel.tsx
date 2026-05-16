import Link from "next/link";
import { adminTaskCounts, listLongPendingTasks } from "@/server/actions/tasks";
import { formatIST } from "@/lib/time";

/**
 * Admin / manager dashboard panel for task oversight.
 *
 * Shows three numbers (assigned / submitted / overdue) plus a list of
 * tasks that have been pending for >3 days. Renders nothing when there
 * are zero tasks in the system — empty state lives on /tasks/admin.
 */
export async function TasksAdminPanel() {
  const [counts, longPending] = await Promise.all([
    adminTaskCounts(),
    listLongPendingTasks(5),
  ]);

  const hasAny =
    counts.assigned +
      counts.submitted +
      counts.completed +
      counts.rejected +
      counts.cancelled >
    0;

  // Empty state — surface the CTA so admin/manager always know where to
  // create the first task instead of waiting for the panel to appear.
  if (!hasAny) {
    return (
      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium text-ik-ink-2">Team tasks</div>
            <p className="mt-1 text-[12.5px] text-ik-ink-3">
              No tasks yet. Use the admin board to assign work to any user.
            </p>
          </div>
          <Link
            href="/tasks/admin"
            className="rounded-md bg-brand-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-700"
          >
            Assign a task →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-ik-rule bg-ik-card">
      <header className="flex items-center justify-between border-b border-ik-rule p-3">
        <div className="text-[12px] font-medium text-ik-ink-2">Team tasks</div>
        <div className="flex items-center gap-3">
          <Link
            href="/tasks/admin"
            className="rounded-md bg-brand-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand-700"
          >
            Assign new
          </Link>
          <Link
            href="/tasks/admin?tab=PENDING"
            className="text-[11px] text-ik-ink-3 hover:text-brand"
          >
            Admin board →
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px bg-ik-rule sm:grid-cols-4">
        <Stat label="Assigned" value={counts.assigned} />
        <Stat
          label="Awaiting review"
          value={counts.submitted}
          highlight={counts.submitted > 0}
        />
        <Stat label="Overdue" value={counts.overdue} alert={counts.overdue > 0} />
        <Stat
          label="Long-pending"
          value={counts.longPending}
          alert={counts.longPending > 0}
        />
      </div>

      {longPending.length > 0 && (
        <div className="border-t border-ik-rule p-3">
          <div className="mb-2 text-[10.5px] uppercase tracking-wide text-ik-ink-3">
            Pending &gt; 3 days
          </div>
          <ul className="grid gap-1.5 text-[12.5px]">
            {longPending.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3"
              >
                <Link
                  href={`/tasks/${t.id}`}
                  className="min-w-0 truncate text-brand hover:underline"
                >
                  {t.title}
                </Link>
                <span className="shrink-0 text-[11px] text-ik-ink-3">
                  {t.assignedTo.name} ·{" "}
                  <span className="font-mono">{formatIST(t.assignedAt, "dd MMM")}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
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
    <div className="bg-ik-card p-3">
      <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{label}</div>
      <div
        className={
          "mt-1 font-mono text-[18px] " +
          (alert ? "text-alert" : highlight ? "text-brand-700" : "text-ik-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}
