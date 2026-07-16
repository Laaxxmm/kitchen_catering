"use client";

import { Fragment, type ReactNode, useState } from "react";

/**
 * Shows only the first `limit` items of a list, with a muted "Show all (N)"
 * toggle that reveals the rest in place. Keeps every role dashboard short —
 * the caller sorts urgent-first, so the capped view is always the N that
 * matter most. Renders a <ul>; each `children` call returns an <li>.
 */
export function CappedList<T>({
  items,
  limit = 6,
  children,
  className,
  keyOf,
}: {
  items: T[];
  limit?: number;
  children: (item: T, index: number) => ReactNode;
  className?: string;
  keyOf: (item: T) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, limit);

  return (
    <>
      <ul className={className}>
        {shown.map((item, i) => (
          <Fragment key={keyOf(item)}>{children(item, i)}</Fragment>
        ))}
      </ul>
      {items.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[12px] text-brand hover:underline"
        >
          {expanded ? "Show less" : `Show all (${items.length})`}
        </button>
      )}
    </>
  );
}
