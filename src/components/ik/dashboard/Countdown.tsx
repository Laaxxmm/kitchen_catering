"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/** "1d 3h" / "2h 15m" / "45m" from a millisecond span. */
function formatDur(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin <= 0) return "now";
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Live countdown to a target time. Colour-codes urgency so staff work the
 * soonest deadlines first:
 *   overdue / < 30 min  → red
 *   < 2 h               → amber
 *   otherwise           → calm grey
 * Computed client-side only (state stays null on first paint) so there's
 * no server/client hydration mismatch. Shared by the chef + driver boards.
 */
export function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (now === null) return null;

  const diff = new Date(target).getTime() - now;
  const overdue = diff < 0;
  const label = formatDur(Math.abs(diff));
  const tone: "alert" | "amber" | "calm" = overdue
    ? "alert"
    : diff < 30 * 60_000
      ? "alert"
      : diff < 2 * 60 * 60_000
        ? "amber"
        : "calm";
  const cls =
    tone === "alert"
      ? "bg-alert text-white"
      : tone === "amber"
        ? "bg-amber-wash text-ik-ink ring-1 ring-amber"
        : "bg-ik-paper-alt text-ik-ink-2 ring-1 ring-ik-rule";
  const text = overdue
    ? label === "now"
      ? "Due now"
      : `Overdue ${label}`
    : label === "now"
      ? "Due now"
      : `Due in ${label}`;
  return (
    <span
      className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold " + cls}
    >
      <Clock size={11} />
      {text}
    </span>
  );
}
