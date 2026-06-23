"use client";

import { WorkTabs } from "@/components/ik/dashboard/WorkTabs";
import { formatIST } from "@/lib/time";

export type LogBucket = "today" | "week" | "earlier";

export interface LogRow {
  id: string;
  bucket: LogBucket;
  primary: string;
  secondary: string | null;
  time: string;
  person: string | null;
  items: string[];
}

/**
 * Shared time-tabbed log board for the housekeeping + maintenance
 * dashboards. These modules record completed work (issues to rooms /
 * activities done) rather than a queue of pending actions, so the board
 * groups recent entries by Today / This week / Earlier — same tab styling
 * as the chef and driver boards, doubling as a quick date filter.
 */
export function LogBoard({ rows, unit = "entries" }: { rows: LogRow[]; unit?: string }) {
  const buckets: { key: LogBucket; label: string; hint: string }[] = [
    { key: "today", label: "Today", hint: `Today's ${unit}` },
    { key: "week", label: "This week", hint: "Last 7 days" },
    { key: "earlier", label: "Earlier", hint: "Older records" },
  ];
  const grouped: Record<LogBucket, LogRow[]> = { today: [], week: [], earlier: [] };
  for (const r of rows) grouped[r.bucket].push(r);

  const tabs = buckets.map((b) => ({ key: b.key, label: b.label, hint: b.hint, count: grouped[b.key].length }));

  return (
    <WorkTabs tabs={tabs} emptyHint={`Nothing in {tab}.`}>
      {(active) => (
        <ul className="grid gap-2">
          {grouped[active as LogBucket].map((r) => (
            <li key={r.id} className="rounded-md border border-ik-rule bg-ik-card p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-ik-ink">{r.primary}</span>
                <span className="text-[11.5px] text-ik-ink-3">{formatIST(new Date(r.time), "EEE d MMM HH:mm")}</span>
              </div>
              {r.secondary && <div className="mt-0.5 text-[12px] text-ik-ink-2">{r.secondary}</div>}
              {r.items.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {r.items.map((it, i) => (
                    <span key={i} className="rounded bg-ik-paper-alt px-1.5 py-0.5 text-[11px] text-ik-ink-2 ring-1 ring-ik-rule">
                      {it}
                    </span>
                  ))}
                </div>
              )}
              {r.person && <div className="mt-1 text-[11px] text-ik-ink-3">by {r.person}</div>}
            </li>
          ))}
        </ul>
      )}
    </WorkTabs>
  );
}
