import Link from "next/link";
import { TaskStatus } from "@prisma/client";
import { formatIST } from "@/lib/time";
import { listTasks, myTaskCounts } from "@/server/actions/tasks";

/**
 * Per-user dashboard panel: open tasks assigned to me, with the next 5 by
 * target date and a tiny three-stat strip (open / overdue / submitted).
 * Renders nothing when the user has no tasks at all — empty state lives
 * on /tasks itself.
 */
export async function MyTasksPanel() {
  const [counts, openTasks] = await Promise.all([
    myTaskCounts(),
    listTasks({ tab: "PENDING", scope: "MINE" }),
  ]);

  // Hide entirely if the user has zero engagement: no open, no submitted,
  // no completed history. Surface the panel as soon as they get their
  // first assignment.
  if (
    counts.open === 0 &&
    counts.submitted === 0 &&
    counts.completed === 0 &&
    counts.rejected === 0
  ) {
    return null;
  }

  const next = openTasks.slice(0, 5);

  return (
    <section className="rounded-md border border-ik-rule bg-ik-card">
      <header className="flex items-center justify-between border-b border-ik-rule p-3">
        <div className="text-[12px] font-medium text-ik-ink-2">My tasks</div>
        <Link href="/tasks" className="text-[11px] text-ik-ink-3 hover:text-brand">
          View all →
        </Link>
      </header>

      <div className="grid grid-cols-3 gap-px bg-ik-rule">
        <Stat label="Open" value={counts.open} highlight={counts.open > 0} />
        <Stat label="Overdue" value={counts.overdue} alert={counts.overdue > 0} />
        <Stat
          label="Awaiting review"
          value={counts.submitted}
          highlight={counts.submitted > 0}
        />
      </div>

      {next.length > 0 && (
        <ul className="divide-y divide-ik-rule">
          {next.map((t) => {
            const overdue =
              (t.status === TaskStatus.ASSIGNED ||
                t.status === TaskStatus.REJECTED) &&
              t.targetDate.getTime() < Date.now();
            return (
              <li key={t.id}>
                <Link
                  href={`/tasks/${t.id}`}
                  className="flex items-center justify-between gap-3 p-3 text-[12.5px] hover:bg-ik-paper-alt"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-ik-ink">{t.title}</span>
                    {t.status === TaskStatus.REJECTED && (
                      <span className="ml-2 text-[10.5px] font-medium uppercase tracking-wide text-alert">
                        rejected · re-do
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      "shrink-0 font-mono text-[11.5px] " +
                      (overdue ? "text-alert" : "text-ik-ink-3")
                    }
                  >
                    {formatIST(t.targetDate, "dd MMM, HH:mm")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
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
