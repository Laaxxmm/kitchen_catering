import Link from "next/link";
import { TaskPriority, TaskStatus } from "@prisma/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatIST } from "@/lib/time";

interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  targetDate: Date;
  assignedAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  assignedTo: { id: string; name: string; role: string };
  assignedBy: { id: string; name: string; role: string };
}

const PRIORITY_TONE: Record<TaskPriority, string> = {
  LOW: "bg-ik-paper-alt text-ik-ink-3",
  NORMAL: "bg-ik-paper-alt text-ik-ink-2",
  HIGH: "bg-alert/10 text-alert",
};

function PriorityPill({ p }: { p: TaskPriority }) {
  return (
    <span
      className={
        "inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide " +
        PRIORITY_TONE[p]
      }
    >
      {p.toLowerCase()}
    </span>
  );
}

function isOverdue(t: TaskRow): boolean {
  if (t.status === TaskStatus.COMPLETED || t.status === TaskStatus.CANCELLED)
    return false;
  if (t.status === TaskStatus.SUBMITTED) return false;
  return t.targetDate.getTime() < Date.now();
}

export function TaskList({
  tasks,
  showAssignee = true,
  emptyHint = "No tasks here.",
}: {
  tasks: TaskRow[];
  showAssignee?: boolean;
  emptyHint?: string;
}) {
  if (tasks.length === 0) {
    return <p className="text-[13px] text-ik-ink-3">{emptyHint}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Task</TableHead>
          <TableHead>Priority</TableHead>
          {showAssignee && <TableHead>Assignee</TableHead>}
          <TableHead>Assigned by</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((t) => {
          const overdue = isOverdue(t);
          return (
            <TableRow key={t.id}>
              <TableCell className="max-w-[280px]">
                <Link
                  href={`/tasks/${t.id}`}
                  className="font-medium text-brand hover:underline"
                >
                  {t.title}
                </Link>
              </TableCell>
              <TableCell>
                <PriorityPill p={t.priority} />
              </TableCell>
              {showAssignee && (
                <TableCell>
                  <span className="text-[13px]">{t.assignedTo.name}</span>
                  <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                    {t.assignedTo.role}
                  </div>
                </TableCell>
              )}
              <TableCell>
                <span className="text-[13px]">{t.assignedBy.name}</span>
              </TableCell>
              <TableCell>
                <span
                  className={
                    "font-mono text-[12px] " + (overdue ? "text-alert" : "text-ik-ink-2")
                  }
                >
                  {formatIST(t.targetDate, "dd MMM, HH:mm")}
                </span>
                {overdue && (
                  <div className="text-[10.5px] font-medium uppercase tracking-wide text-alert">
                    Overdue
                  </div>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={t.status} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
