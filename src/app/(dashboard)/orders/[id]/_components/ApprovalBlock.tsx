"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";

type Action = "store" | "manager" | "override";

interface Props {
  action: Action;
  storeNote?: string | null;
  onApprove?: (note: string) => Promise<void>;
  onReject?: (note: string) => Promise<void>;
  onOverride?: (reason: string) => Promise<void>;
}

export function ApprovalBlock({ action, storeNote, onApprove, onReject, onOverride }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [text, setText] = useState("");

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        toast.success("Saved");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  if (action === "store") {
    return (
      <div className="rounded-md border border-brand-200 bg-brand-50 p-4">
        <h3 className="mb-2 font-medium text-[14px] text-brand-700">Store approval</h3>
        <p className="mb-3 text-[12.5px] text-ik-ink-2">
          Confirm ingredients can be sourced for this order. A note is required for approve or reject.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="storeNote">Note (required)</Label>
          <Textarea id="storeNote" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || !text.trim() || !onApprove}
              onClick={() => onApprove && run(() => onApprove(text))}
            >
              {pending ? "Saving…" : "Approve"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !text.trim() || !onReject}
              onClick={() => onReject && run(() => onReject(text))}
            >
              Reject
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (action === "manager") {
    return (
      <div className="rounded-md border border-brand-200 bg-brand-50 p-4">
        <h3 className="mb-2 font-medium text-[14px] text-brand-700">Manager approval</h3>
        <p className="mb-3 text-[12.5px] text-ik-ink-2">
          Sign off on price + commercial terms. Note is optional but recommended on reject.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="mgrNote">Note (optional)</Label>
          <Textarea id="mgrNote" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button" disabled={pending || !onApprove} onClick={() => onApprove && run(() => onApprove(text))}>
              {pending ? "Saving…" : "Approve"}
            </Button>
            <Button type="button" variant="outline" disabled={pending || !onReject} onClick={() => onReject && run(() => onReject(text))}>
              Reject
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // override
  return (
    <div className="rounded-md border border-amber-wash bg-amber-wash p-4">
      <h3 className="mb-2 font-medium text-[14px] text-amber">Override store rejection</h3>
      {storeNote && (
        <blockquote className="mb-3 border-l-2 border-amber pl-3 text-[12.5px] italic text-ik-ink-2">
          Store said: {storeNote}
        </blockquote>
      )}
      <div className="grid gap-2">
        <Label htmlFor="overrideReason">Reason (required)</Label>
        <Textarea id="overrideReason" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <div>
          <Button type="button" disabled={pending || !text.trim() || !onOverride} onClick={() => onOverride && run(() => onOverride(text))}>
            {pending ? "Saving…" : "Override and approve"}
          </Button>
        </div>
      </div>
    </div>
  );
}
