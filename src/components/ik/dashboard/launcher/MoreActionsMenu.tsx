"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

export interface MoreAction {
  label: string;
  href: string;
}

/**
 * Secondary create-flows tucked behind a single "More" button next to the
 * primary "Take a new order" action — so the launcher isn't a wall of
 * equal-weight buttons. Closes on outside click / Escape.
 */
export function MoreActionsMenu({ items }: { items: MoreAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 items-center gap-1.5 rounded-md border border-ik-rule bg-ik-card px-4 text-[13px] font-medium text-ik-ink-2 transition hover:border-brand-200 hover:text-brand-700"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        More
        <ChevronDown size={15} className={"transition " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-md border border-ik-rule bg-ik-card shadow-lg"
        >
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 text-[13px] text-ik-ink-2 transition hover:bg-ik-paper-alt hover:text-ik-ink"
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
