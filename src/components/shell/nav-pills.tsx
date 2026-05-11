"use client";
// TODO refactor: 163 lines — over 150-line soft cap. Tabs vs pills variants; split when a third variant lands.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavPillLink = {
  kind: "link";
  href: string;
  label: string;
  /**
   * Optional extra prefixes that should also light the pill.
   * Useful when a grouped entry points at "/admin/users" but we also want
   * a nested path like "/admin/audit" to show the pill as active.
   */
  matchPrefixes?: string[];
};

export type NavPillGroup = {
  kind: "group";
  label: string;
  items: Array<{ href: string; label: string; description?: string }>;
};

export type NavPillItem = NavPillLink | NavPillGroup;

function isActive(pathname: string, href: string, extra?: string[]): boolean {
  if (href === "/dashboard") {
    return pathname === "/" || pathname === "/dashboard";
  }
  if (pathname === href || pathname.startsWith(href + "/")) return true;
  if (extra) {
    for (const p of extra) {
      if (pathname === p || pathname.startsWith(p + "/")) return true;
    }
  }
  return false;
}

export function NavPills({ items }: { items: NavPillItem[] }) {
  const pathname = usePathname() ?? "";
  return (
    <nav className="hidden items-center gap-0.5 text-[13px] lg:flex">
      {items.map((n) =>
        n.kind === "link" ? (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition",
              isActive(pathname, n.href, n.matchPrefixes)
                ? "bg-brand text-white"
                : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {n.label}
          </Link>
        ) : (
          <NavGroup key={n.label} group={n} pathname={pathname} />
        ),
      )}
    </nav>
  );
}

function NavGroup({
  group,
  pathname,
}: {
  group: NavPillGroup;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = group.items.some((it) => isActive(pathname, it.href));

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onDocClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("mousedown", onDocClick);
        document.removeEventListener("keydown", onKey);
      };
    }
  }, [open]);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1 rounded-md px-3 py-1.5 font-medium transition",
          active
            ? "bg-brand text-white"
            : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
        )}
      >
        {group.label}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open ? "rotate-180" : "rotate-0",
            active ? "text-white/80" : "text-slate-500",
          )}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-[220px] overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          {group.items.map((it) => {
            const itActive = isActive(pathname, it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                className={cn(
                  "flex flex-col gap-0.5 rounded px-2.5 py-1.5 text-[13px] transition",
                  itActive
                    ? "bg-brand/10 text-brand"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <span className="font-medium">{it.label}</span>
                {it.description && (
                  <span
                    className={cn(
                      "text-[11px]",
                      itActive ? "text-brand/80" : "text-slate-500",
                    )}
                  >
                    {it.description}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
