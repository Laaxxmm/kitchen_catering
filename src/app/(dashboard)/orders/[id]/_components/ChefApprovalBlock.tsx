"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";

interface OrderItemOption {
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
  onApprove: (note: string) => Promise<void>;
  onSuggest: (note: string) => Promise<void>;
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
export function ChefApprovalBlock({ onApprove, onSuggest, orderItems, dishes }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [note, setNote] = useState("");

  // Swap helper state — held locally; the chef can compose multiple swaps
  // by clicking "Add to note" repeatedly, each appending one line.
  const [showSwap, setShowSwap] = useState(false);
  const [fromDish, setFromDish] = useState(orderItems[0]?.label ?? "");
  const [toDishId, setToDishId] = useState(dishes[0]?.id ?? "");
  const [swapReason, setSwapReason] = useState("");

  function run(fn: () => Promise<void>, successMsg: string) {
    if (!note.trim()) {
      toast.error("Please add a short note before continuing");
      return;
    }
    startTransition(async () => {
      try {
        await fn();
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

  function appendSwapToNote() {
    if (!fromDish) return toast.error("Pick the dish to replace");
    const to = dishes.find((d) => d.id === toDishId);
    if (!to) return toast.error("Pick a replacement dish");
    const line =
      `Replace "${fromDish}" with "${to.name}"` +
      (swapReason.trim() ? ` — ${swapReason.trim()}` : "");
    setNote((prev) => (prev.trim() ? `${prev.trim()}\n• ${line}` : `• ${line}`));
    setSwapReason("");
    toast.success("Swap added to note");
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
                      <option key={it.label} value={it.label}>
                        {it.label} · {it.portions}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="swap-to" className="text-[11.5px]">With this dish</Label>
                <select
                  id="swap-to"
                  value={toDishId}
                  onChange={(e) => setToDishId(e.target.value)}
                  className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]"
                >
                  {dishes.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code ? `${d.code} · ${d.name}` : d.name}
                    </option>
                  ))}
                </select>
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
              <Button type="button" size="sm" variant="outline" onClick={appendSwapToNote}>
                Add swap to note
              </Button>
            </div>
            <p className="text-[10.5px] text-ik-ink-3">
              Adds a structured bullet to the note below. You can repeat for multiple swaps.
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
