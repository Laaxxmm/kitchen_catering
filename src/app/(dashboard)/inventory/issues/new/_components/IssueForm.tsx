"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import type { IngredientIssueInputT } from "@/lib/validators";
import type { ActionResultWith } from "@/lib/action-result";

interface IngredientOption {
  id: string;
  sku: string;
  name: string;
  unit: string;
  onHandQty: string;
}
interface OrderOption {
  id: string;
  code: string;
  customerName: string;
}

interface Props {
  ingredients: IngredientOption[];
  orders: OrderOption[];
  initialOrderId?: string | null;
  onSubmit: (input: IngredientIssueInputT) => Promise<ActionResultWith<{ id: string }>>;
}

export function IssueForm({ ingredients, orders, initialOrderId, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const initial = initialOrderId && orders.some((o) => o.id === initialOrderId) ? initialOrderId : "";
  const [orderId, setOrderId] = useState(initial || orders[0]?.id || "");
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");

  const selectedIng = ingredients.find((i) => i.id === ingredientId);
  const selectedOrder = orders.find((o) => o.id === orderId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return toast.error("Pick an order");
    if (!ingredientId) return toast.error("Pick an ingredient");
    if (!qty || Number(qty) <= 0) return toast.error("Enter a positive quantity");
    startTransition(async () => {
      try {
        const res = await onSubmit({
          ingredientId,
          orderId,
          qty,
          note: note.trim() || null,
        });
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success("Stock recorded against the order");
        router.push(`/orders/${orderId}`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-4">
      <div className="grid gap-1">
        <Label htmlFor="orderId">Order</Label>
        <select
          id="orderId"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
        >
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} · {o.customerName}
            </option>
          ))}
        </select>
        {selectedOrder && (
          <p className="text-[11.5px] text-ik-ink-3">
            Cost will count toward <strong>{selectedOrder.code}</strong>&apos;s P&amp;L.
          </p>
        )}
      </div>

      <div className="grid gap-1">
        <Label htmlFor="ingredientId">Ingredient</Label>
        <select
          id="ingredientId"
          value={ingredientId}
          onChange={(e) => setIngredientId(e.target.value)}
          className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
        >
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.sku} · {i.name} (on hand: {i.onHandQty} {i.unit})
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="qty">Quantity used{selectedIng ? ` (${selectedIng.unit})` : ""}</Label>
        <Input
          id="qty"
          type="number"
          step="any"
          min="0.001"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="e.g. 5.000"
        />
        {selectedIng && (
          <p className="text-[11.5px] text-ik-ink-3">
            Available: {selectedIng.onHandQty} {selectedIng.unit}
          </p>
        )}
      </div>

      <div className="grid gap-1">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea
          id="note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. extra rice for last-minute headcount bump"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record stock used"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
