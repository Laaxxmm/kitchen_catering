"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  chefNote: string;
  chefName: string;
  onApprove: (note: string) => Promise<ActionResult>;
  onReject: (note: string) => Promise<ActionResult>;
}

/**
 * Manager-facing block when the chef has proposed changes to the order
 * (status === CHANGES_PROPOSED_BY_CHEF). Manager sees the chef's note and
 * decides:
 *
 *   - Approve the chef's changes → order advances straight to chef requisition;
 *     proforma is generated and emailed to the customer.
 *   - Reject → order is terminated (REJECTED_BY_MANAGER).
 *
 * Note is optional but encouraged for the audit trail.
 */
export function ManagerChangeBlock({ chefNote, chefName, onApprove, onReject }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [note, setNote] = useState("");

  function run(fn: () => Promise<ActionResult>, successMsg: string) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
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
    <div className="rounded-md border border-amber-wash bg-amber-wash p-4">
      <h3 className="mb-1 font-medium text-[14px] text-amber">Chef has proposed changes</h3>
      <p className="mb-3 text-[12.5px] text-ik-ink-2">
        {chefName} reviewed the order and is suggesting changes. Read the note below,
        update the order items if needed, then approve or reject.
      </p>
      {chefNote && (
        <blockquote className="mb-3 whitespace-pre-wrap border-l-2 border-amber bg-white/60 p-2 pl-3 text-[12.5px] italic text-ik-ink-2">
          {chefNote}
        </blockquote>
      )}
      <div className="grid gap-2">
        <Label htmlFor="mgrChangeNote">Manager note (optional)</Label>
        <Textarea
          id="mgrChangeNote"
          rows={3}
          placeholder="e.g. Discussed with customer, kachori is fine"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => onApprove(note), "Approved — back to the chef to accept")
            }
          >
            {pending ? "Saving…" : "Approve chef's changes"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => onReject(note), "Order rejected")}
          >
            Reject — order can&apos;t proceed
          </Button>
        </div>
      </div>
    </div>
  );
}
