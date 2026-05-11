import * as React from "react";
import { cn } from "@/lib/utils";
import type { OrderStatus, TimeEntryStatus } from "@prisma/client";

type Status =
  | OrderStatus
  | TimeEntryStatus
  | "ACTIVE"
  | "DRAFT"
  | "ON_HOLD"
  | "COMPLETED"
  | "CANCELLED"
  | "OPEN"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "PENDING"
  | "PAID"
  | "RECEIVED"
  | "CLOSED";

// IK editorial status dot. Colors resolve through the IK oklch / hex tokens
// defined in globals.css so dots and foreground stay on the Fresh basil
// palette without touching each caller.
const MAP: Record<string, { dot: string; fg: string; label: string }> = {
  // Order / generic
  DRAFT: { dot: "var(--ik-ink3)", fg: "text-[color:var(--ik-ink3)]", label: "Draft" },
  ACTIVE: { dot: "var(--ik-positive)", fg: "text-[color:var(--ik-positive)]", label: "Active" },
  ON_HOLD: { dot: "var(--ik-amber)", fg: "text-[color:var(--ik-amber)]", label: "On hold" },
  COMPLETED: { dot: "var(--ik-accent)", fg: "text-[color:var(--ik-accent-ink)]", label: "Completed" },
  CANCELLED: { dot: "var(--ik-alert)", fg: "text-[color:var(--ik-alert)]", label: "Cancelled" },
  CLOSED: { dot: "var(--ik-ink3)", fg: "text-[color:var(--ik-ink3)]", label: "Closed" },
  // Time entry / approval
  OPEN: { dot: "var(--ik-info)", fg: "text-[color:var(--ik-info)]", label: "Open" },
  SUBMITTED: { dot: "var(--ik-amber)", fg: "text-[color:var(--ik-amber)]", label: "Submitted" },
  APPROVED: { dot: "var(--ik-positive)", fg: "text-[color:var(--ik-positive)]", label: "Approved" },
  REJECTED: { dot: "var(--ik-alert)", fg: "text-[color:var(--ik-alert)]", label: "Rejected" },
  // Invoice / payment / receipt
  PENDING: { dot: "var(--ik-amber)", fg: "text-[color:var(--ik-amber)]", label: "Pending" },
  PAID: { dot: "var(--ik-positive)", fg: "text-[color:var(--ik-positive)]", label: "Paid" },
  RECEIVED: { dot: "var(--ik-positive)", fg: "text-[color:var(--ik-positive)]", label: "Received" },
};

export function StatusBadge({
  status,
  className,
}: {
  status: Status | string;
  className?: string;
}) {
  const s =
    MAP[status] ??
    {
      dot: "var(--ik-ink3)",
      fg: "text-[color:var(--ik-ink3)]",
      label: status,
    };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium",
        s.fg,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.dot }} />
      {s.label}
    </span>
  );
}
