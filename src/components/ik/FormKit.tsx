import type { ReactNode } from "react";

/**
 * Shared "create form" building blocks (Emerald & Gold). One pattern for
 * every new/create page: section cards with a serif header + gold accent
 * bar, a two-column field grid that folds to one column on mobile, gold
 * required-asterisks, and a sticky save bar so Save is always reachable.
 */

/** A grouped section card. `cols` controls the field grid (defaults to 2). */
export function FormSection({
  title,
  hint,
  children,
  cols = 2,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  cols?: 1 | 2;
}) {
  return (
    <section className="rounded-[14px] border border-ik-rule bg-ik-card p-4 sm:p-5">
      <h2 className="ik-accent-bar font-serif text-[15px] text-brand-700">{title}</h2>
      {hint && <p className="mt-0.5 text-[12px] text-ik-ink-3">{hint}</p>}
      <div className={"mt-4 grid gap-4 " + (cols === 2 ? "sm:grid-cols-2" : "")}>{children}</div>
    </section>
  );
}

/** Wrap a field that should span the full width of a 2-column section. */
export function FullWidth({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2">{children}</div>;
}

/** Gold required-asterisk. Put after a label's text. */
export function RequiredMark() {
  return <span className="text-gold" aria-hidden="true"> *</span>;
}

/**
 * Sticky bottom action bar — primary "Save…" (emerald) + ghost "Cancel".
 * Stays reachable on long forms without scrolling. Children are the buttons.
 */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-ik-rule bg-ik-paper/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-ik-paper/75 md:-mx-6 md:px-6">
      {children}
    </div>
  );
}

/**
 * Friendly empty state — a short line + a primary next-step button, never a
 * dead sentence. `action` is the CTA (e.g. a <Link><Button/></Link>).
 */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-ik-rule bg-ik-card p-8 text-center">
      <div className="text-[15px] font-medium text-ik-ink">{title}</div>
      {body && <p className="mx-auto mt-1 max-w-md text-[12.5px] text-ik-ink-2">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
