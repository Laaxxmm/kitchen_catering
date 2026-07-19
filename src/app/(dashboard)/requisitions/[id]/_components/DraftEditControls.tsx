"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

// #17: the chef edits their DRAFT requisition before submitting — change a
// line's quantity, remove a line, add a missing ingredient. Server actions
// re-check the DRAFT status + role; these controls only render on drafts.

function useCall() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function call(fn: () => Promise<ActionResult>, done: () => void = () => {}) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success("Saved");
        done();
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Action failed");
      }
    });
  }
  return { pending, call };
}

export function DraftLineControls({
  lineId,
  requestedQty,
  onUpdateQty,
  onRemove,
}: {
  lineId: string;
  requestedQty: string;
  onUpdateQty: (lineId: string, qty: string) => Promise<ActionResult>;
  onRemove: (lineId: string) => Promise<ActionResult>;
}) {
  const { pending, call } = useCall();
  const [qty, setQty] = useState(requestedQty);
  const changed = qty.trim() !== requestedQty && qty.trim() !== "" && Number(qty) > 0;

  return (
    <div className="flex items-center gap-1 text-[12.5px]">
      <input
        type="number"
        step="any"
        min="0.001"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="h-8 w-24 rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
        aria-label="Requested quantity"
      />
      {changed && (
        <Button type="button" size="sm" disabled={pending} onClick={() => call(() => onUpdateQty(lineId, qty.trim()))}>
          Save
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => call(() => onRemove(lineId))}>
        Remove
      </Button>
    </div>
  );
}

export function DraftAddLine({
  ingredients,
  onAdd,
}: {
  ingredients: Array<{ id: string; sku: string; name: string; unit: string }>;
  onAdd: (ingredientId: string, qty: string) => Promise<ActionResult>;
}) {
  const { pending, call } = useCall();
  const [ingredientId, setIngredientId] = useState("");
  const [qty, setQty] = useState("1");
  const picked = ingredients.find((i) => i.id === ingredientId);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-ik-rule bg-ik-card p-3">
      <span className="text-[12.5px] font-medium text-ik-ink">Add ingredient</span>
      <div className="min-w-[240px]">
        <Combobox
          value={ingredientId}
          onChange={setIngredientId}
          options={ingredients.map((i) => ({ value: i.id, label: `${i.sku} · ${i.name}` }))}
          placeholder="Type to search an ingredient…"
          emptyText="No ingredient matches"
        />
      </div>
      <input
        type="number"
        step="any"
        min="0.001"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="h-8 w-24 rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
        aria-label="Quantity to request"
      />
      {picked && <span className="text-[12px] text-ik-ink-3">{picked.unit}</span>}
      <Button
        type="button"
        size="sm"
        disabled={pending || !ingredientId || !qty.trim() || Number(qty) <= 0}
        onClick={() =>
          call(
            () => onAdd(ingredientId, qty.trim()),
            () => {
              setIngredientId("");
              setQty("1");
            },
          )
        }
      >
        + Add line
      </Button>
    </div>
  );
}
