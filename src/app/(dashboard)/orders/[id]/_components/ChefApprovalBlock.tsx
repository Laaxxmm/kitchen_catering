"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface OrderItemOption {
  /** The order-item id — the swap targets this specific line. */
  id: string;
  /** The dish name currently on the order (e.g. "Samosa"). */
  label: string;
  portions: string;
}

interface DishOption {
  id: string;
  name: string;
  code: string | null;
}

interface Props {
  onApprove: (note: string) => Promise<ActionResult>;
  onSuggest: (note: string) => Promise<ActionResult>;
  /** Apply a dish swap directly to the order (chef's call). */
  onApplySwap: (orderItemId: string, newDishId: string, reason: string) => Promise<ActionResult>;
  /** Current dishes on the order — populates the "Replace" dropdown. */
  orderItems: OrderItemOption[];
  /** Full dish catalogue — populates the "With" dropdown. */
  dishes: DishOption[];
}

/**
 * Chef-facing block on the order detail page when the order sits at
 * PENDING_CHEF_APPROVAL. Two clear paths:
 *
 *   1. Approve order — looks good        → proforma fires, order moves on
 *   2. Suggest changes to manager        → manager reviews; can approve or reject
 *
 * For the "suggest changes" path the chef can either type a freeform
 * note, or use the structured swap helper (Replace [X] with [Y] +
 * reason). The helper appends a formatted line into the note so the
 * manager sees a consistent record and the audit trail is clean.
 *
 * A note is required for either action so there's always context for the
 * manager (and for the audit log).
 */
export function ChefApprovalBlock({ onApprove, onSuggest, onApplySwap, orderItems, dishes }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [note, setNote] = useState("");

  // Swap helper state — held locally; the chef can compose multiple swaps
  // by clicking "Add to note" repeatedly, each appending one line.
  const [showSwap, setShowSwap] = useState(false);
  const [fromDish, setFromDish] = useState(orderItems[0]?.id ?? "");
  const [toDishId, setToDishId] = useState(dishes[0]?.id ?? "");
  const [swapReason, setSwapReason] = useState("");

  // Searchable options for the "with this dish" picker — the full catalogue
  // can be long, so the chef types to filter instead of scrolling.
  const dishOptions = useMemo(
    () => dishes.map((d) => ({ value: d.id, label: d.code ? `${d.code} · ${d.name}` : d.name })),
    [dishes],
  );

  function run(fn: () => Promise<ActionResult>, successMsg: string) {
    if (!note.trim()) {
      toast.error("Please add a short note before continuing");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(successMsg);
        setNote("");
        setSwapReason("");
        setShowSwap(false);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  // Apply the swap directly to the order item — the dish genuinely changes,
  // so the requisition and everything downstream use the new dish. Doesn't
  // need the approval note (it's its own logged action).
  function applySwap() {
    if (!fromDish) return toast.error("Pick the dish to replace");
    if (!toDishId) return toast.error("Pick a replacement dish");
    startTransition(async () => {
      try {
        const res = await onApplySwap(fromDish, toDishId, swapReason.trim());
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Dish swapped on the order");
        setSwapReason("");
        setShowSwap(false);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Swap failed");
      }
    });
  }

  return (
    <div className="rounded-md border border-brand-200 bg-brand-50 p-4">
      <h3 className="mb-1 font-medium text-[14px] text-brand-700">Chef review</h3>
      <p className="mb-3 text-[12.5px] text-ik-ink-2">
        Look over the items. If everything is good, approve so we can send the proforma
        to the customer. If something needs to change (e.g. &ldquo;no samosa, suggest kachori&rdquo;),
        pick &ldquo;Suggest changes&rdquo; — the manager will review.
      </p>

      {/* Structured swap helper — collapsed by default; expand only when
          the chef actually wants to suggest a substitution. */}
      <div className="mb-3 rounded-md border border-ik-rule bg-ik-card p-3">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-medium text-ik-ink">Suggest a dish swap</span>
          <button
            type="button"
            onClick={() => setShowSwap((v) => !v)}
            className="text-[11.5px] text-brand hover:underline"
          >
            {showSwap ? "Hide" : "Open"}
          </button>
        </div>
        {showSwap && (
          <div className="mt-2 grid gap-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="swap-from" className="text-[11.5px]">Replace this dish</Label>
                <select
                  id="swap-from"
                  value={fromDish}
                  onChange={(e) => setFromDish(e.target.value)}
                  className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]"
                >
                  {orderItems.length === 0 ? (
                    <option value="">(no items on order)</option>
                  ) : (
                    orderItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.label} · {it.portions}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="swap-to" className="text-[11.5px]">With this dish</Label>
                <Combobox
                  id="swap-to"
                  value={toDishId}
                  onChange={setToDishId}
                  options={dishOptions}
                  placeholder="Search a dish…"
                  emptyText="No dish matches"
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="swap-reason" className="text-[11.5px]">Reason (optional)</Label>
              <input
                id="swap-reason"
                value={swapReason}
                onChange={(e) => setSwapReason(e.target.value)}
                placeholder="e.g. ingredient unavailable, customer prefers"
                className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]"
              />
            </div>
            <div>
              <Button type="button" size="sm" disabled={pending} onClick={applySwap}>
                {pending ? "Swapping…" : "Apply swap"}
              </Button>
            </div>
            <p className="text-[10.5px] text-ik-ink-3">
              Replaces the dish on the order right away and reprices that line — the requisition will
              use the new dish. Repeat for multiple swaps.
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="chefNote">Note (required)</Label>
        <Textarea
          id="chefNote"
          rows={4}
          placeholder="e.g. All items look good — confirmed for prep"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending || !note.trim()}
            onClick={() => run(() => onApprove(note), "Order approved — proforma generated")}
          >
            {pending ? "Saving…" : "Approve order — looks good"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !note.trim()}
            onClick={() => run(() => onSuggest(note), "Sent to manager for review")}
          >
            Suggest changes to manager
          </Button>
        </div>
      </div>
    </div>
  );
}
