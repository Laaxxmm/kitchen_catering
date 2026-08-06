import Link from "next/link";
import { TaskStatus } from "@prisma/client";
import { listTasks, myTaskCounts } from "@/server/actions/tasks";

/**
 * Per-user task strip: ONE line on every dashboard. It used to render a
 * three-stat grid plus the next five tasks, which cost half the home screen
 * on a store or chef login for information that rarely changes.
 *
 * What earns space here is only what needs acting on — anything overdue, a
 * rejected task to re-do, and the newest title. Everything else collapses to
 * a count, and /tasks remains the full list.
 */
export async function MyTasksPanel() {
  const [counts, openTasks] = await Promise.all([
    myTaskCounts(),
    listTasks({ tab: "PENDING", scope: "MINE" }),
  ]);

  // Nothing assigned, nothing in history — the panel stays out of the way
  // entirely. The empty state lives on /tasks.
  if (
    counts.open === 0 &&
    counts.submitted === 0 &&
    counts.completed === 0 &&
    counts.rejected === 0
  ) {
    return null;
  }

  // "New" = assigned and not yet acted on. A rejected task is counted with
  // them: it is back in the assignee's court and needs redoing, which is the
  // same kind of demand on their attention.
  const needsAction = openTasks.filter(
    (t) => t.status === TaskStatus.ASSIGNED || t.status === TaskStatus.REJECTED,
  );
  const newest = needsAction[0];
  const hasRejected = needsAction.some((t) => t.status === TaskStatus.REJECTED);
  // Only a demand for attention gets colour. A tidy list stays quiet, so that
  // when the strip does light up it still means something.
  const loud = counts.overdue > 0 || hasRejected;

  return (
    <section
      className={
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-[12.5px] " +
        (loud ? "border-alert bg-alert-wash" : "border-ik-rule bg-ik-card")
      }
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-ik-ink-3">
        My tasks
      </span>

      {needsAction.length > 0 && (
        <span
          className={
            "rounded-full px-2 py-0.5 text-[11px] font-medium " +
            (loud ? "bg-alert text-white" : "bg-brand-500 text-white")
          }
        >
          {needsAction.length} to do
        </span>
      )}

      {/* The newest one by name, so the strip says something specific rather
          than only a number — truncated so a long title can't wrap the row. */}
      {newest && (
        <Link
          href={`/tasks/${newest.id}`}
          className="min-w-0 flex-1 truncate text-ik-ink hover:text-brand hover:underline"
        >
          {newest.title}
          {newest.status === TaskStatus.REJECTED && (
            <span className="ml-2 text-[10.5px] font-medium uppercase tracking-wide text-alert">
              rejected · re-do
            </span>
          )}
        </Link>
      )}

      <span className="ml-auto flex items-center gap-3 text-[11.5px] text-ik-ink-3">
        {counts.overdue > 0 && (
          <span className="font-medium text-alert">{counts.overdue} overdue</span>
        )}
        {counts.submitted > 0 && <span>{counts.submitted} awaiting review</span>}
        <Link href="/tasks" className="hover:text-brand">
          View all →
        </Link>
      </span>
    </section>
  );
}
