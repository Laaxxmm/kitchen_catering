import * as React from "react";
import { OrderStatus } from "@prisma/client";
import type { TimeEntryStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/order-status";

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

// Generic-status fallbacks for non-Order statuses (TimeEntry, etc.).
const TONE_TO_CSS: Record<"neutral" | "pending" | "positive" | "alert", { dot: string; fg: string }> = {
  neutral:  { dot: "var(--ik-ink3)",     fg: "text-[color:var(--ik-ink3)]" },
  pending:  { dot: "var(--ik-amber)",    fg: "text-[color:var(--ik-amber)]" },
  positive: { dot: "var(--ik-positive)", fg: "text-[color:var(--ik-positive)]" },
  alert:    { dot: "var(--ik-alert)",    fg: "text-[color:var(--ik-alert)]" },
};

const GENERIC_MAP: Record<string, { dot: string; fg: string; label: string }> = {
  ACTIVE:    { ...TONE_TO_CSS.positive, label: "Active" },
  ON_HOLD:   { ...TONE_TO_CSS.pending,  label: "On hold" },
  CLOSED:    { ...TONE_TO_CSS.neutral,  label: "Closed" },
  OPEN:      { dot: "var(--ik-info)", fg: "text-[color:var(--ik-info)]", label: "Open" },
  SUBMITTED: { ...TONE_TO_CSS.pending,  label: "Submitted" },
  APPROVED:  { ...TONE_TO_CSS.positive, label: "Approved" },
  REJECTED:  { ...TONE_TO_CSS.alert,    label: "Rejected" },
  PENDING:   { ...TONE_TO_CSS.pending,  label: "Pending" },
  PAID:      { ...TONE_TO_CSS.positive, label: "Paid" },
  RECEIVED:  { ...TONE_TO_CSS.positive, label: "Received" },
};

function resolve(status: string): { dot: string; fg: string; label: string } {
  // Prefer OrderStatus (friendly labels live in lib/order-status.ts).
  if (status in STATUS_LABEL) {
    const orderStatus = status as OrderStatus;
    const tone = STATUS_TONE[orderStatus] ?? "neutral";
    return { ...TONE_TO_CSS[tone], label: STATUS_LABEL[orderStatus] };
  }
  if (status in GENERIC_MAP) return GENERIC_MAP[status];
  // Fallback: humanise the raw enum.
  return {
    ...TONE_TO_CSS.neutral,
    label: status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}

export function StatusBadge({
  status,
  className,
}: {
  status: Status | string;
  className?: string;
}) {
  const s = resolve(status);
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
