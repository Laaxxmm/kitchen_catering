"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  onApprove: (note: string) => Promise<void>;
  onSuggest: (note: string) => Promise<void>;
}

/**
 * Chef-facing block on the order detail page when the order sits at
 * PENDING_CHEF_APPROVAL. Two clear paths:
 *
 *   1. Approve order — looks good        → proforma fires, order moves on
 *   2. Suggest changes to manager        → manager reviews; can approve or reject
 *
 * A note is required for either action so there's always context for the
 * manager (and for the audit log).
 */
export function ChefApprovalBlock({ onApprove, onSuggest }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [note, setNote] = useState("");

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
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <div className="rounded-md border border-brand-200 bg-brand-50 p-4">
      <h3 className="mb-1 font-medium text-[14px] text-brand-700">Chef review</h3>
      <p className="mb-3 text-[12.5px] text-ik-ink-2">
        Look over the items. If everything is good, approve so we can send the proforma
        to the customer. If something needs to change (e.g. &ldquo;no samosa, suggest kachori&rdquo;),
        pick &ldquo;Suggest changes&rdquo; — the manager will review.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="chefNote">Note (required)</Label>
        <Textarea
          id="chefNote"
          rows={3}
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
