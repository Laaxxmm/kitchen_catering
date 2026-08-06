"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  /** Why this revision is critical — one plain sentence each. */
  reasons: string[];
  /** What the manager is about to change — one line each. */
  changes: string[];
  /** Submission in flight; keeps the dialog up and both buttons dead. */
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Last stop before a revision lands on an order the kitchen is already
 * working. Deliberately an alertdialog, not a toast: the manager has to
 * read why it's costly and pick, and the safe option (cancel) is the one
 * that's focused, first in tab order and reachable with Escape.
 */
export function CriticalReviseDialog({ open, reasons, changes, pending, onCancel, onConfirm }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Latest handler behind a ref so the focus/trap effect depends on `open`
  // alone — re-running it on every render would yank focus back to Cancel
  // while the manager is tabbing.
  const cancelCb = useRef(onCancel);
  cancelCb.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Escape cancels. It must never be a shortcut for "yes".
        e.preventDefault();
        cancelCb.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      // ponytail: buttons are the only focusable things in here; widen the
      // selector if this dialog ever grows an input or a link.
      const nodes = panel?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!panel || !nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const inside = panel.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[hsl(var(--foreground))]/40 px-4 py-12"
      onClick={() => !pending && onCancel()}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="critical-revise-title"
        aria-describedby="critical-revise-body"
        className="w-full max-w-lg rounded-2xl border border-alert/50 bg-ik-card p-5 shadow-card-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="critical-revise-title" className="text-[15px] font-semibold text-alert">
          Revise an order the kitchen is already on?
        </h2>
        <div id="critical-revise-body" className="mt-3 grid gap-3 text-[13px] text-ik-ink">
          <ul className="grid list-disc gap-1 pl-5">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div>
            <div className="mb-1 text-[12px] font-medium text-ik-ink-2">You are about to change:</div>
            <ul className="grid list-disc gap-1 pl-5 text-ik-ink-2">
              {changes.length === 0 ? (
                <li>Nothing but the revision note.</li>
              ) : (
                changes.map((c) => <li key={c}>{c}</li>)
              )}
            </ul>
          </div>
          <p className="rounded-md border border-amber bg-amber-wash p-2.5 text-[12.5px]">
            The chef and the store are alerted the moment you save. They may not have time to adjust —
            food already cooked or ingredients already issued for this order can go to waste.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button ref={cancelRef} type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Keep the order as it is
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? "Saving…" : "Revise anyway — alert the kitchen"}
          </Button>
        </div>
      </div>
    </div>
  );
}
