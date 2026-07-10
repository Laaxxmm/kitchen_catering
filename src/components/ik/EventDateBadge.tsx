"use client";

import { Countdown } from "@/components/ik/dashboard/Countdown";
import { formatIST } from "@/lib/time";

/**
 * How urgent is this order by its event date? Drives the big priority badge
 * so staff can't miss that an order is today/tomorrow (or days away and
 * shouldn't be worked yet). Shared by the chef and F&B work screens so
 * their urgency rules can't drift apart.
 */
export function eventPriority(eventDate: string): { label: string; cls: string; soon: boolean; days: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const ev = new Date(eventDate);
  const evDay = new Date(ev);
  evDay.setHours(0, 0, 0, 0);
  const days = Math.round((evDay.getTime() - start.getTime()) / 86400000);
  if (days < 0) return { label: "OVERDUE", cls: "bg-alert text-white", soon: true, days };
  if (days === 0) return { label: "TODAY", cls: "bg-alert text-white", soon: true, days };
  if (days === 1) return { label: "TOMORROW", cls: "bg-amber text-white", soon: true, days };
  if (days <= 3) return { label: `IN ${days} DAYS`, cls: "bg-amber text-white", soon: true, days };
  return { label: `IN ${days} DAYS`, cls: "bg-ik-paper-alt text-ik-ink-2 ring-1 ring-ik-rule", soon: false, days };
}

/**
 * The prominent event-date block on work-screen cards: urgency pill
 * (TODAY / TOMORROW / IN N DAYS), the date in bold, the time under it, and
 * the live "due in" countdown. One component for the chef AND F&B screens
 * so the two boards always read the same.
 */
export function EventDateBadge({ target, timeNote }: { target: string; timeNote?: string }) {
  const prio = eventPriority(target);
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide " + prio.cls}>
        {prio.label}
      </span>
      <span className="text-[17px] font-bold leading-none text-ik-ink">
        {formatIST(new Date(target), "EEE d MMM")}
      </span>
      <span className="text-[12px] font-medium text-ik-ink-2">
        {timeNote ? `${timeNote} ` : ""}
        {formatIST(new Date(target), "HH:mm")}
      </span>
      <Countdown target={target} />
    </div>
  );
}
