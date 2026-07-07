"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  /** Bound "use server" shim that RETURNS the action's result. */
  action: (reason: string) => Promise<ActionResult>;
  submitLabel: string;
  successMessage: string;
  placeholder?: string;
}

/**
 * Compact inline reason + button control for table rows (e.g. "Reverse"
 * a payment/voucher). Replaces bare `<form action={shim}>` rows that
 * swallowed the converted action's `{ ok: false, error }` result —
 * refusals now toast, and the row refreshes on success.
 */
export function InlineReasonForm({ action, submitLabel, successMessage, placeholder = "Reason" }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [reason, setReason] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Please enter a reason");
      return;
    }
    startTransition(async () => {
      try {
        const res = await action(trimmed);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(successMessage);
        setReason("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <form onSubmit={submit} className="inline">
      <input
        placeholder={placeholder}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="h-6 w-24 rounded border border-ik-rule bg-ik-card px-1 text-[11px]"
      />
      <Button type="submit" size="sm" variant="outline" className="ml-1" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
