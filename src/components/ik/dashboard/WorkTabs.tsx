"use client";

import { type ReactNode, useState } from "react";

export interface WorkTabDef {
  key: string;
  label: string;
  hint?: string;
  count: number;
}

/**
 * Shared tabbed work-board shell used by every role's "dead easy" dashboard
 * (chef, driver, manager, accounts, sales, store…). Renders a row of big
 * labelled tabs with a live count each, opens on the first tab that has
 * work, and hands the active key to a render-prop so each board supplies
 * its own cards. Keeps all the boards visually identical for non-technical
 * staff.
 */
export function WorkTabs({
  tabs,
  children,
  emptyHint = "Nothing here right now.",
}: {
  tabs: WorkTabDef[];
  children: (activeKey: string) => ReactNode;
  emptyHint?: string;
}) {
  const firstWithWork = tabs.find((t) => t.count > 0)?.key ?? tabs[0]?.key ?? "";
  const [active, setActive] = useState<string>(firstWithWork);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <section>
      <div className="mb-3 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                "min-w-[150px] flex-1 rounded-md border p-3 text-left transition " +
                (on
                  ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                  : "border-ik-rule bg-ik-card hover:border-brand-200")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ik-ink">{t.label}</span>
                <span
                  className={
                    "grid min-h-[20px] min-w-[20px] place-items-center rounded-full px-1.5 font-mono text-[11px] font-bold leading-none " +
                    (t.count > 0 ? "bg-brand-500 text-white" : "bg-ik-paper-alt text-ik-ink-3")
                  }
                >
                  {t.count}
                </span>
              </div>
              {t.hint && <div className="mt-0.5 text-[11px] text-ik-ink-3">{t.hint}</div>}
            </button>
          );
        })}
      </div>

      {activeTab && activeTab.count === 0 ? (
        <div className="rounded-md border border-ik-rule bg-ik-card p-5 text-[13px] text-ik-ink-2">
          {emptyHint.replace("{tab}", activeTab.label)}
        </div>
      ) : (
        children(active)
      )}
    </section>
  );
}
