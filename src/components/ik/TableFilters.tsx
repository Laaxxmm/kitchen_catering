"use client";
// TODO refactor: 207 lines — over 150-line soft cap. Several widget variants; split per-widget when reused.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// Reusable filter widgets for any data table on the app. They write to URL
// search params so the server-rendered page can re-fetch with the filters
// applied — same pattern as DashboardDescriptionFilter / InvoicesFyFilter.

/**
 * Debounced text-search input that drives the `q` URL param (or whatever
 * `paramName` you pass). Server pages read `searchParams.q` and use it
 * to filter the Prisma query.
 *
 * The input is debounced 250ms so we don't push a router event on every
 * keystroke. Keeps the URL bar quiet and prevents flicker.
 */
export function TableSearchInput({
  current,
  placeholder = "Search…",
  paramName = "q",
  width = 240,
}: {
  current: string;
  placeholder?: string;
  paramName?: string;
  width?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(current);

  // Sync local state when URL changes externally (e.g. browser back).
  useEffect(() => {
    setValue(current);
  }, [current]);

  const push = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = next.trim();
      if (trimmed) params.set(paramName, trimmed);
      else params.delete(paramName);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, paramName],
  );

  // Debounced push.
  useEffect(() => {
    if (value === current) return;
    const t = setTimeout(() => push(value), 250);
    return () => clearTimeout(t);
  }, [value, current, push]);

  return (
    <div className="relative flex items-center" style={{ width }}>
      <svg
        className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-slate-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded border border-slate-200 bg-white pl-7 pr-7 text-[12px] text-slate-800 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setValue("");
            push("");
          }}
          className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * Date-range filter. Two `<input type="date">` inputs that write
 * `?<fromParam>=YYYY-MM-DD&<toParam>=YYYY-MM-DD` into the URL. Empty
 * value clears the param. Server pages parse the strings and apply
 * IST-aware bounds via `date-fns-tz`.
 */
export function TableDateRange({
  fromCurrent,
  toCurrent,
  fromParam = "from",
  toParam = "to",
  label,
}: {
  fromCurrent: string;
  toCurrent: string;
  fromParam?: string;
  toParam?: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setOne = useCallback(
    (paramName: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = value.trim();
      if (trimmed) params.set(paramName, trimmed);
      else params.delete(paramName);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <input
        type="date"
        aria-label={`${label} from`}
        value={fromCurrent}
        max={toCurrent || undefined}
        onChange={(e) => setOne(fromParam, e.target.value)}
        className="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] text-slate-800 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30"
      />
      <span className="text-[11px] text-slate-400">–</span>
      <input
        type="date"
        aria-label={`${label} to`}
        value={toCurrent}
        min={fromCurrent || undefined}
        onChange={(e) => setOne(toParam, e.target.value)}
        className="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] text-slate-800 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30"
      />
    </div>
  );
}

/**
 * Status / category dropdown. Behaves like DashboardDescriptionFilter but
 * generic over param name + label.
 */
export function TableSelectFilter({
  options,
  current,
  paramName,
  label,
  allLabel = "All",
}: {
  options: { value: string; label: string }[];
  current: string;
  paramName: string;
  label: string;
  allLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(paramName, value);
      else params.delete(paramName);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, paramName],
  );

  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] text-slate-800 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
