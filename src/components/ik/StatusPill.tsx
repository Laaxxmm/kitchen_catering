import type { ReactNode } from "react";

export type PillTone = "red" | "amber" | "green" | "grey";

// One shared status-pill language across every redesigned page:
//   red   = needs you / out of stock / overdue
//   amber = in progress / running low
//   green = done / in stock / paid
//   grey  = neutral / draft / cancelled
const TONE: Record<PillTone, string> = {
  red: "bg-alert-wash text-alert ring-1 ring-alert/30",
  amber: "bg-amber-wash text-amber-700 ring-1 ring-amber/40",
  green: "bg-positive/10 text-positive ring-1 ring-positive/30",
  grey: "bg-ik-paper-alt text-ik-ink-3 ring-1 ring-ik-rule",
};

export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " + TONE[tone]
      }
    >
      {children}
    </span>
  );
}
