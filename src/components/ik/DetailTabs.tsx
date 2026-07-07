"use client";

import { useState, type ReactNode } from "react";

export interface DetailTab {
  key: string;
  label: string;
  count?: number;
  content: ReactNode;
}

/**
 * Simple underline tab switcher for entity detail pages (customer, vendor…),
 * so long sections like "order history" get their own prominent tab instead
 * of being buried below the edit form. Server-rendered content is passed in
 * as `content` — this client shell just toggles which one shows.
 */
export function DetailTabs({ tabs, defaultKey }: { tabs: DetailTab[]; defaultKey?: string }) {
  // defaultKey lets a page deep-link into a tab (e.g. ?tab=invoices, so a
  // filter-form submit reloads the route on the right tab). Unknown keys
  // fall back to the first tab.
  const initial =
    defaultKey && tabs.some((t) => t.key === defaultKey) ? defaultKey : tabs[0]?.key ?? "";
  const [active, setActive] = useState(initial);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1 border-b border-ik-rule">
        {tabs.map((t) => {
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                "-mb-px border-b-2 px-4 py-2 text-[13px] transition " +
                (on ? "border-brand-500 font-semibold text-brand-700" : "border-transparent text-ik-ink-2 hover:text-ik-ink")
              }
            >
              {t.label}
              {typeof t.count === "number" && (
                <span className={"ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10.5px] " + (on ? "bg-brand-50 text-brand-700" : "bg-ik-paper-alt text-ik-ink-3")}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div>{activeTab?.content}</div>
    </div>
  );
}
