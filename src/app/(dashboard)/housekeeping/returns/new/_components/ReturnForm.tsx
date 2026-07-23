"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import { returnHousekeepingStock } from "@/server/actions/housekeeping";

interface Item {
  id: string;
  name: string;
  unit: string;
  currentStock: string;
  inCirculation: string;
}

/**
 * Close the towel/linen loop: pick a reusable item, say how many are coming
 * back, and whether they were washed & returned (back to clean stock) or
 * lost/damaged (gone). Only items with units out in circulation appear.
 */
export function ReturnForm({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const out = items.filter((i) => Number(i.inCirculation) > 0);
  const [itemId, setItemId] = useState(out[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [outcome, setOutcome] = useState<"returned" | "lost">("returned");

  const item = out.find((i) => i.id === itemId);
  const inputCls = "h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId) return toast.error("Pick an item");
    if (qty.trim() === "" || Number(qty) <= 0) return toast.error("Enter how many are coming back");
    startTransition(async () => {
      try {
        const res = await returnHousekeepingStock({ itemId, qty, outcome });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(outcome === "returned" ? "Returned to clean stock" : "Written off");
        router.push("/housekeeping");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not record the return");
      }
    });
  }

  if (out.length === 0) {
    return (
      <p className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px] text-ik-ink-2">
        Nothing is out in use right now. Reusable items appear here once they&apos;ve been issued to a room.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-lg gap-4 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
      <label className="grid gap-1">
        <span className="text-[12px] text-ik-ink-2">Item</span>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
          {out.map((i) => (
            <option key={i.id} value={i.id}>{i.name} — {i.inCirculation} {i.unit} out · {i.currentStock} clean</option>
          ))}
        </select>
      </label>

      <div className="grid gap-1">
        <span className="text-[12px] text-ik-ink-2">What happened?</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOutcome("returned")}
            className={"flex-1 rounded-md border px-3 py-2 text-[12.5px] " + (outcome === "returned" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ik-rule")}>
            Washed &amp; returned
          </button>
          <button type="button" onClick={() => setOutcome("lost")}
            className={"flex-1 rounded-md border px-3 py-2 text-[12.5px] " + (outcome === "lost" ? "border-amber bg-amber-wash text-amber-700" : "border-ik-rule")}>
            Lost / damaged
          </button>
        </div>
      </div>

      <label className="grid gap-1">
        <span className="text-[12px] text-ik-ink-2">How many{item ? ` (${item.unit}, ${item.inCirculation} out)` : ""}?</span>
        <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls + " font-mono"} placeholder="e.g. 12" />
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{outcome === "returned" ? "Return to stock" : "Write off"}</Button>
      </div>
    </form>
  );
}
