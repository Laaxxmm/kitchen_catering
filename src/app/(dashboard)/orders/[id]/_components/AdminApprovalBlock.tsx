"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";

interface Props {
  onApprove: (note: string) => Promise<void>;
  onReject: (note: string) => Promise<void>;
}

/**
 * Admin gate on the order detail page when the order sits at
 * PENDING_ADMIN_APPROVAL. Workflow v3: every new order — including the
 * admin's own — has to be explicitly approved before the chef sees it.
 *
 * Two clear paths:
 *   1. Approve order — passes it to the chef for feasibility review
 *   2. Reject order — terminal (REJECTED_BY_ADMIN)
 *
 * A note is required for either action so there's always context in the
 * audit trail.
 */
export function AdminApprovalBlock({ onApprove, onReject }: Props) {
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
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <div className="rounded-md border border-brand-200 bg-brand-50 p-4">
      <h3 className="mb-1 font-medium text-[14px] text-brand-700">Admin review</h3>
      <p className="mb-3 text-[12.5px] text-ik-ink-2">
        This order needs your sign-off before the chef sees it. Approve so the kitchen can start
        planning, or reject if it shouldn&apos;t go ahead. Either action is logged.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="adminNote">Note (required)</Label>
        <Textarea
          id="adminNote"
          rows={3}
          placeholder="e.g. Confirmed pricing with sales — approved for kitchen prep"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending || !note.trim()}
            onClick={() => run(() => onApprove(note), "Approved — sent to the chef")}
          >
            {pending ? "Saving…" : "Approve — send to chef"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !note.trim()}
            onClick={() => run(() => onReject(note), "Order rejected")}
          >
            Reject — order can&apos;t proceed
          </Button>
        </div>
      </div>
    </div>
  );
}
