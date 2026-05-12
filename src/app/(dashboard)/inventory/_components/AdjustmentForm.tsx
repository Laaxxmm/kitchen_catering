"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { IngredientAdjustmentInputT } from "@/lib/validators";

interface IngredientOption {
  id: string;
  name: string;
  sku: string;
  unit: string;
  onHandQty: string;
}

interface Props {
  ingredients: IngredientOption[];
  onSubmit: (input: IngredientAdjustmentInputT) => Promise<{ id: string }>;
  redirectOnSuccess?: string;
}

const REASONS = [
  "Spoilage / write-off",
  "Damage / breakage",
  "Opening-balance correction",
  "Count correction (post-audit tweak)",
  "Theft / loss",
  "Other",
] as const;

export function AdjustmentForm({ ingredients, onSubmit, redirectOnSuccess }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? "");
  const [mode, setMode] = useState<"absolute" | "delta">("absolute");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [note, setNote] = useState("");

  const selected = useMemo(
    () => ingredients.find((i) => i.id === ingredientId) ?? null,
    [ingredientId, ingredients],
  );

  const preview = useMemo(() => {
    if (!selected || !value.trim()) return null;
    const num = Number(value);
    if (isNaN(num)) return null;
    const current = Number(selected.onHandQty);
    const after = mode === "absolute" ? num : current + num;
    const delta = after - current;
    return {
      before: current,
      after,
      delta,
      unit: selected.unit,
      negative: after < 0,
    };
  }, [selected, value, mode]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientId) return toast.error("Pick an ingredient");
    if (!value.trim()) return toast.error("Enter a quantity");
    const resolvedReason = reason === "Other" ? customReason.trim() : reason;
    if (!resolvedReason) return toast.error("A reason is required");
    if (preview?.negative) return toast.error("Adjusted on-hand cannot be negative");
    if (preview && preview.delta === 0) return toast.error("Adjusted quantity matches current on-hand");

    const payload: IngredientAdjustmentInputT = {
      ingredientId,
      reason: resolvedReason,
      note: note.trim() || null,
      ...(mode === "absolute" ? { newQty: value } : { delta: value }),
    };

    startTransition(async () => {
      try {
        await onSubmit(payload);
        toast.success("Stock adjusted");
        if (redirectOnSuccess) router.push(redirectOnSuccess);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Adjustment failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-4">
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
        <Label>How are you entering the change?</Label>
        <div className="flex gap-3 text-[13px]">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={mode === "absolute"}
              onChange={() => setMode("absolute")}
            />
            Set new on-hand (absolute)
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={mode === "delta"}
              onChange={() => setMode("delta")}
            />
            Add/subtract (signed delta)
          </label>
        </div>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="value">
          {mode === "absolute"
            ? `New on-hand quantity${selected ? ` (${selected.unit})` : ""}`
            : `Delta — positive to add, negative to remove${selected ? ` (${selected.unit})` : ""}`}
        </Label>
        <Input
          id="value"
          type="number"
          step="0.001"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === "absolute" ? "e.g. 12.500" : "e.g. -2.000"}
        />
      </div>

      {preview && (
        <div
          className={
            "rounded-md border p-3 text-[12.5px] " +
            (preview.negative
              ? "border-alert bg-alert-wash text-alert"
              : "border-brand-200 bg-brand-50 text-ik-ink")
          }
        >
          <div className="font-medium">Preview</div>
          <div className="mt-1 font-mono">
            {preview.before.toFixed(3)} {preview.unit} → {preview.after.toFixed(3)} {preview.unit}
            <span className="ml-2 text-ik-ink-3">
              ({preview.delta >= 0 ? "+" : ""}
              {preview.delta.toFixed(3)} {preview.unit})
            </span>
          </div>
          {preview.negative && <div className="mt-1">Cannot save — on-hand would go negative.</div>}
        </div>
      )}

      <div className="grid gap-1">
        <Label htmlFor="reason">Reason</Label>
        <select
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
        >
          {REASONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        {reason === "Other" && (
          <Input
            placeholder="Describe the reason"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            className="mt-2"
          />
        )}
      </div>

      <div className="grid gap-1">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea
          id="note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Any extra context — visible on the audit list"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Adjust stock"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
