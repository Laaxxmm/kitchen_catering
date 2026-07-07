"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  onSubmit: (input: {
    amount: string;
    source: string;
    reference: string | null;
  }) => Promise<ActionResult>;
}

/**
 * Top-up form for a petty-cash float. Calls the page's bound "use server"
 * shim and toasts the action's refusal instead of silently swallowing it
 * like the old bare `<form action>` did.
 */
export function TopUpForm({ onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) {
      toast.error("Please enter an amount");
      return;
    }
    startTransition(async () => {
      try {
        const res = await onSubmit({
          amount,
          source,
          reference: reference.trim() || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Top-up recorded");
        setAmount("");
        setReference("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="topupAmount">Amount (₹)</Label>
          <Input id="topupAmount" type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="source">Source</Label>
          <select
            id="source"
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="OWNER_CONTRIB">Owner contribution</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="reference">Reference</Label>
        <Input id="reference" placeholder="optional" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Add top-up"}</Button>
    </form>
  );
}
