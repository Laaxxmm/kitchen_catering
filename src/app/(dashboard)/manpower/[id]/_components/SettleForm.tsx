"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  /** Approved estimate, as the opening figure — usually right, often not. */
  estimate: string;
  /** Already-settled figure, when accounts are correcting themselves. */
  current: string | null;
  onSettle: (input: { actualCost: string; note: string | null }) => Promise<ActionResult>;
}

/** What the labour actually invoiced. Payment reads this figure, not the
 *  estimate, so it has to be entered before a rupee can move. */
export function SettleForm({ estimate, current, onSettle }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actualCost, setActualCost] = useState(current ?? estimate);
  const [note, setNote] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Blank-guard before the server turns this into a Decimal.
    if (!actualCost.trim() || !(Number(actualCost) >= 0)) return toast.error("Enter what it actually cost");
    startTransition(async () => {
      try {
        const res = await onSettle({ actualCost: actualCost.trim(), note: note.trim() || null });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Actual cost recorded");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not record the cost");
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card">
      <h3 className="mb-1 font-medium text-[14px] text-ik-ink">
        {current ? "Correct the actual cost" : "Record the actual cost"}
      </h3>
      <p className="mb-3 text-[12px] text-ik-ink-3">
        What the labour actually invoiced. This is the figure that gets paid — the request stays open until it&apos;s in.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="actualCost">Actual cost (₹)</Label>
          <Input id="actualCost" type="number" min="0" step="0.01" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="settleNote">Note (optional)</Label>
          <Textarea id="settleNote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it differs from the estimate." />
        </div>
      </div>
      <div className="mt-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record actual cost"}</Button>
      </div>
    </form>
  );
}
