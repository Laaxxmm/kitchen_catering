"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import { adjustStoreStock, type StoreKey } from "@/server/actions/store-stock";

interface Item {
  id: string;
  name: string;
  unit: string;
  currentStock: string;
}

const REASONS = ["Physical count", "Opening balance", "Damage / write-off", "Correction", "Other"];

/**
 * Dead-simple "adjust stock" form for the non-kitchen stores. Pick an item,
 * either set its new on-hand (after counting) or add/remove a quantity, give
 * a reason. For purchased incoming stock the user uses "Record receipt".
 */
export function StoreAdjustForm({ store, items, backHref }: { store: StoreKey; items: Item[]; backHref: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [mode, setMode] = useState<"set" | "delta">("set");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");

  const item = items.find((i) => i.id === itemId);
  const inputCls = "h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId) return toast.error("Pick an item");
    if (qty.trim() === "") return toast.error("Enter a quantity");
    startTransition(async () => {
      try {
        const res = await adjustStoreStock({ store, itemId, mode, qty, reason, note: note.trim() || undefined });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Stock adjusted");
        router.push(backHref);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not adjust stock");
      }
    });
  }

  if (items.length === 0) {
    return <p className="text-[13px] text-ik-ink-2">No items in this store yet — add items first.</p>;
  }

  return (
    <form onSubmit={submit} className="grid max-w-lg gap-4 rounded-md border border-ik-rule bg-ik-card p-4">
      <label className="grid gap-1">
        <span className="text-[12px] text-ik-ink-2">Item</span>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.name} (on hand {i.currentStock} {i.unit})</option>
          ))}
        </select>
      </label>

      <div className="grid gap-1">
        <span className="text-[12px] text-ik-ink-2">What are you doing?</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("set")}
            className={"flex-1 rounded-md border px-3 py-2 text-[12.5px] " + (mode === "set" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ik-rule")}>
            Set new on-hand
          </button>
          <button type="button" onClick={() => setMode("delta")}
            className={"flex-1 rounded-md border px-3 py-2 text-[12.5px] " + (mode === "delta" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ik-rule")}>
            Add / remove
          </button>
        </div>
      </div>

      <label className="grid gap-1">
        <span className="text-[12px] text-ik-ink-2">
          {mode === "set" ? `New on-hand quantity${item ? ` (${item.unit})` : ""}` : `Amount to add (use a minus sign to remove)${item ? ` (${item.unit})` : ""}`}
        </span>
        <input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls + " font-mono"} placeholder={mode === "set" ? "e.g. 40" : "e.g. 10 or -3"} />
      </label>

      <label className="grid gap-1">
        <span className="text-[12px] text-ik-ink-2">Reason</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
          {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-[12px] text-ik-ink-2">Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="e.g. counted during monthly audit" />
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>Save adjustment</Button>
      </div>
    </form>
  );
}
