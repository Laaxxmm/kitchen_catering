"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import { requestGoodsFromStore } from "@/server/actions/banquet";

/**
 * F&B Service → store keeper "please procure this" form. The store keeper
 * gets it as a high-priority task + a notification with a raise-PO link.
 */
export function RequestForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");

  function submit() {
    if (summary.trim().length < 3) {
      toast.error("Describe what you need (min 3 characters).");
      return;
    }
    startTransition(async () => {
      try {
        await requestGoodsFromStore({ summary, note: note.trim() || undefined });
        toast.success("Request sent to the store keeper");
        router.push("/banquet");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not send the request");
      }
    });
  }

  return (
    <div className="grid max-w-xl gap-4 rounded-md border border-ik-rule bg-ik-card p-4">
      <div className="grid gap-1.5">
        <Label htmlFor="summary">What do you need?</Label>
        <Textarea
          id="summary"
          rows={3}
          placeholder="e.g. 500 paper cups (250 ml), 10 chafing-fuel tins, 200 dinner plates"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <p className="text-[11.5px] text-ik-ink-3">
          List the items and quantities. The store keeper raises the purchase order and records the GRN when the goods arrive.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="note">Note <span className="text-ik-ink-3">(optional)</span></Label>
        <Textarea
          id="note"
          rows={2}
          placeholder="When it's needed by, preferred supplier, etc."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button disabled={pending} onClick={submit}>{pending ? "Sending…" : "Send request to store"}</Button>
      </div>
    </div>
  );
}
