import type { ReactNode } from "react";

/**
 * One shared status-pill language across every redesigned page. The four
 * semantic tones carry the meaning most pills need:
 *   red   = needs you / out of stock / overdue
 *   amber = in progress / running low
 *   green = done / in stock / paid
 *   grey  = neutral / draft / cancelled
 * The rest exist for one reason: the order list, where seventeen statuses
 * used to fall into four colours and "Delivered" looked exactly like
 * "Invoiced". Each order status now has a hue of its own (ORDER_STATUS_PILL
 * in lib/order-status.ts). Light wash + dark ink reads in both themes.
 */
export type PillTone =
  | "red"
  | "amber"
  | "green"
  | "grey"
  | "gold"
  | "lime"
  | "orange"
  | "sky"
  | "indigo"
  | "violet"
  | "teal"
  | "fuchsia"
  | "cyan"
  | "emerald"
  | "ink";

const TONE: Record<PillTone, string> = {
  red: "bg-alert-wash text-alert ring-1 ring-alert/30",
  amber: "bg-amber-wash text-amber-700 ring-1 ring-amber/40",
  green: "bg-positive/10 text-positive ring-1 ring-positive/30",
  grey: "bg-ik-paper-alt text-ik-ink-3 ring-1 ring-ik-rule",
  gold: "bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300",
  lime: "bg-lime-100 text-lime-800 ring-1 ring-lime-300",
  orange: "bg-orange-100 text-orange-800 ring-1 ring-orange-300",
  sky: "bg-sky-100 text-sky-800 ring-1 ring-sky-300",
  indigo: "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-300",
  violet: "bg-violet-100 text-violet-800 ring-1 ring-violet-300",
  teal: "bg-teal-100 text-teal-800 ring-1 ring-teal-300",
  fuchsia: "bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-300",
  cyan: "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-300",
  emerald: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300",
  ink: "bg-ik-ink text-ik-paper ring-1 ring-ik-ink",
};

/** The same hues as a single colour, for dot-style badges. */
export const PILL_DOT: Record<PillTone, string> = {
  red: "var(--ik-alert)",
  amber: "var(--ik-amber)",
  green: "var(--ik-positive)",
  grey: "var(--ik-ink3)",
  gold: "#ca8a04",
  lime: "#4d7c0f",
  orange: "#c2410c",
  sky: "#0369a1",
  indigo: "#4338ca",
  violet: "#6d28d9",
  teal: "#0f766e",
  fuchsia: "#a21caf",
  cyan: "#0e7490",
  emerald: "#047857",
  ink: "var(--ik-ink)",
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
