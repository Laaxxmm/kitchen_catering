"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventDateScope } from "@/lib/time";

interface Props {
  /** Page the pills navigate on, e.g. "/kitchen" or "/dashboard". */
  basePath: string;
  /** Currently active scope (resolve "date" when ?date= is set). */
  scope: EventDateScope;
  /** YYYY-MM-DD backing the date input when scope === "date". */
  date?: string;
  /** Optional per-pill counts (rendered as a small badge when provided). */
  counts?: Partial<Record<Exclude<EventDateScope, "date">, number>>;
}

const PILLS: Array<{ key: Exclude<EventDateScope, "date">; label: string }> = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This week" },
  { key: "all", label: "All" },
];

/**
 * Compact event-date scope row — Today · Tomorrow · This week · All · a
 * date picker — shared by the chef dashboard and the kitchen board. Scope
 * travels in the URL (?scope= / ?date=) so the server component reloads
 * with the right IST window (resolved via istScopeWindow in @/lib/time).
 */
export function EventScopePills({ basePath, scope, date, counts }: Props) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PILLS.map((p) => {
        const on = scope === p.key;
        const count = counts?.[p.key];
        return (
          <Link
            key={p.key}
            href={`${basePath}?scope=${p.key}`}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] " +
              (on
                ? "bg-brand-500 text-white"
                : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
            }
          >
            {p.label}
            {count !== undefined && (
              <span
                className={
                  "rounded-full px-1.5 text-[10.5px] " +
                  (on ? "bg-white/20 text-white" : "bg-ik-rule text-ik-ink-3")
                }
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
      <input
        type="date"
        aria-label="Show a specific date"
        value={scope === "date" ? (date ?? "") : ""}
        onChange={(e) => {
          const v = e.target.value;
          router.push(v ? `${basePath}?date=${v}` : basePath);
        }}
        className={
          "h-7 rounded-full border px-2.5 text-[12px] " +
          (scope === "date"
            ? "border-brand-500 bg-brand-50 text-brand-700"
            : "border-ik-rule bg-ik-paper-alt text-ik-ink-2")
        }
      />
    </div>
  );
}
