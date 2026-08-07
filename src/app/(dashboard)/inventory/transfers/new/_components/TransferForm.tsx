"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { StockStore } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import { STORE_LABELS } from "@/lib/stock-movement";
import { unitsEquivalent } from "@/lib/units";
import type { StockTransferInputT } from "@/lib/validators";
import type { ActionResultWith } from "@/lib/action-result";

export interface TransferItem {
  id: string;
  store: StockStore;
  sku: string | null;
  name: string;
  unit: string;
  stock: string;
}

/** Code first where the catalogue has one — F&B names repeat across sources. */
function itemLabel(i: TransferItem): string {
  return `${i.sku ? `${i.sku} · ` : ""}${i.name} (${i.stock} ${i.unit})`;
}

interface Props {
  items: TransferItem[];
  onSubmit: (input: StockTransferInputT) => Promise<ActionResultWith<{ id: string }>>;
}

const STORES = ["KITCHEN", "FNB", "HOUSEKEEPING"] as const;

const selectClass = "h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]";

export function TransferForm({ items, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [transferredAt, setTransferredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [fromStore, setFromStore] = useState<StockStore>("KITCHEN");
  const [toStore, setToStore] = useState<StockStore>("FNB");
  const [fromItemId, setFromItemId] = useState("");
  const [toItemId, setToItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitsAcknowledged, setUnitsAcknowledged] = useState(false);
  const [notes, setNotes] = useState("");

  const fromItems = items.filter((i) => i.store === fromStore);
  const toItems = items.filter((i) => i.store === toStore);
  const from = fromItems.find((i) => i.id === fromItemId);
  const to = toItems.find((i) => i.id === toItemId);
  // Both units are shown side by side and nothing is ever converted — the
  // confirmation only appears once the user has actually picked a mismatched
  // pair, so it can't be ticked out of habit.
  const unitsDiffer = !!from && !!to && !unitsEquivalent(from.unit, to.unit);

  function changeStore(side: "from" | "to", value: StockStore) {
    if (side === "from") {
      setFromStore(value);
      setFromItemId("");
    } else {
      setToStore(value);
      setToItemId("");
    }
    setUnitsAcknowledged(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (fromStore === toStore) return toast.error("Pick two different stores");
    if (!from) return toast.error("Pick the item leaving the source store");
    if (!to) return toast.error("Pick the item it arrives as in the destination store");
    if (!quantity || Number(quantity) <= 0) return toast.error("Enter a positive quantity");
    if (Number(quantity) > Number(from.stock)) {
      return toast.error(`Only ${from.stock} ${from.unit} of ${from.name} on hand`);
    }
    if (unitsDiffer && !unitsAcknowledged) {
      return toast.error(`Confirm the ${from.unit} → ${to.unit} move — nothing is converted`);
    }

    startTransition(async () => {
      try {
        const res = await onSubmit({
          transferredAt,
          fromStore,
          fromItemId,
          toStore,
          toItemId,
          quantity,
          unitsAcknowledged,
          notes: notes.trim() || null,
        });
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success("Transfer recorded");
        router.push("/inventory/transfers");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-4">
      <div className="grid max-w-xs gap-1">
        <Label htmlFor="transferredAt">Transferred on</Label>
        <Input
          id="transferredAt"
          type="date"
          value={transferredAt}
          onChange={(e) => setTransferredAt(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-3 rounded-md border border-ik-rule p-3">
          <p className="text-[12px] font-medium uppercase tracking-wide text-ik-ink-3">Out of</p>
          <div className="grid gap-1">
            <Label htmlFor="fromStore">Store</Label>
            <select
              id="fromStore"
              className={selectClass}
              value={fromStore}
              onChange={(e) => changeStore("from", e.target.value as StockStore)}
            >
              {STORES.map((s) => (
                <option key={s} value={s}>
                  {STORE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="fromItemId">Item</Label>
            <select
              id="fromItemId"
              className={selectClass}
              value={fromItemId}
              onChange={(e) => {
                setFromItemId(e.target.value);
                setUnitsAcknowledged(false);
              }}
            >
              <option value="">Select an item…</option>
              {fromItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {itemLabel(i)}
                </option>
              ))}
            </select>
            {from && (
              <p className="text-[11.5px] text-ik-ink-3">
                On hand: {from.stock} {from.unit}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-3 rounded-md border border-ik-rule p-3">
          <p className="text-[12px] font-medium uppercase tracking-wide text-ik-ink-3">Into</p>
          <div className="grid gap-1">
            <Label htmlFor="toStore">Store</Label>
            <select
              id="toStore"
              className={selectClass}
              value={toStore}
              onChange={(e) => changeStore("to", e.target.value as StockStore)}
            >
              {STORES.map((s) => (
                <option key={s} value={s}>
                  {STORE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="toItemId">Item</Label>
            <select
              id="toItemId"
              className={selectClass}
              value={toItemId}
              onChange={(e) => {
                setToItemId(e.target.value);
                setUnitsAcknowledged(false);
              }}
            >
              <option value="">Select an item…</option>
              {toItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {itemLabel(i)}
                </option>
              ))}
            </select>
            {to && (
              <p className="text-[11.5px] text-ik-ink-3">
                On hand: {to.stock} {to.unit}
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11.5px] text-ik-ink-3">
        The two stores keep separate catalogues, so pick both sides yourself — nothing is matched by
        name. Items are added in each store&apos;s own screen, by a manager.
      </p>

      <div className="grid max-w-xs gap-1">
        <Label htmlFor="quantity">Quantity{from ? ` (${from.unit})` : ""}</Label>
        <Input
          id="quantity"
          type="number"
          step="any"
          min="0.001"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="e.g. 1.000"
        />
      </div>

      {unitsDiffer && from && to && (
        <label className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-[12.5px] dark:bg-amber-950/30">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={unitsAcknowledged}
            onChange={(e) => setUnitsAcknowledged(e.target.checked)}
          />
          <span>
            <strong>Different units.</strong> {from.name} is tracked in {from.unit}, {to.name} in{" "}
            {to.unit}. Nothing is converted — {quantity || "the"} {from.unit} leaving becomes the
            same number of {to.unit} arriving. Tick to confirm that is what you mean.
          </span>
        </label>
      )}

      <div className="grid gap-1">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. F&B ran out of foil mid-service"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record transfer"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
