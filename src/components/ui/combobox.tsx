"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronsUpDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string };

export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder = "Select…",
  emptyText = "No matches",
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fixed-position coordinates for the portalled panel, measured from the
  // trigger button. Portalling to <body> means no ancestor's overflow
  // (e.g. the line-items table's overflow-x-auto) can clip the list.
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  // Measure the trigger and keep the panel pinned to it while open, so it
  // tracks scroll and resize.
  useEffect(() => {
    if (!open) return;
    function reposition() {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoords({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = filtered[activeIdx];
      if (hit) pick(hit.value);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  const panel =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", left: coords.left, top: coords.top, width: coords.width }}
            className="z-50 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
          >
            <div className="border-b border-[hsl(var(--border))] p-1.5">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search…"
                className="h-8"
              />
            </div>
            <ul className="max-h-60 overflow-auto py-1">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {emptyText}
                </li>
              )}
              {filtered.map((o, idx) => {
                const isActive = idx === activeIdx;
                const isSelected = o.value === value;
                return (
                  <li
                    key={o.value}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(o.value);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px]",
                      isActive ? "bg-[hsl(var(--secondary))]" : "bg-[hsl(var(--card))]",
                      isSelected
                        ? "font-medium text-[hsl(var(--foreground))]"
                        : "text-[hsl(var(--foreground))]/80",
                    )}
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        isSelected ? "text-[hsl(var(--primary))]" : "text-transparent",
                      )}
                    />
                    <span className="truncate">{o.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex h-9 w-full items-center justify-between rounded border border-[hsl(var(--border))] bg-ik-card px-3 py-1.5 text-left text-[13px] text-[hsl(var(--foreground))] transition focus-visible:border-[hsl(var(--ring))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn("truncate", !selected && "text-[hsl(var(--muted-foreground))]")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
      </button>
      {panel}
    </div>
  );
}
