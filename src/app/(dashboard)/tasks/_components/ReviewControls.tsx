"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reviewTask, cancelTask } from "@/server/actions/tasks";
import { isNextNavigationError } from "@/lib/next-error";

export function ReviewControls({
  taskId,
  status,
}: {
  taskId: string;
  status: "SUBMITTED" | "ASSIGNED" | "REJECTED";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "reject" | "cancel">("idle");
  const [reason, setReason] = useState("");

  function approve() {
    startTransition(async () => {
      try {
        await reviewTask({ id: taskId, decision: "APPROVE" });
        toast.success("Approved");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not approve");
      }
    });
  }

  function reject() {
    if (reason.trim().length < 3) {
      toast.error("Rejection reason is required (min 3 characters)");
      return;
    }
    startTransition(async () => {
      try {
        await reviewTask({
          id: taskId,
          decision: "REJECT",
          rejectionReason: reason.trim(),
        });
        toast.success("Rejected — assignee will see your reason");
        setReason("");
        setMode("idle");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not reject");
      }
    });
  }

  function cancel() {
    startTransition(async () => {
      try {
        await cancelTask({ id: taskId, reason: reason.trim() || undefined });
        toast.success("Task cancelled");
        setReason("");
        setMode("idle");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not cancel");
      }
    });
  }

  if (status === "SUBMITTED") {
    return (
      <div className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="text-[12px] font-medium text-ik-ink-2">Review submission</div>
        {mode === "reject" ? (
          <>
            <Textarea
              rows={3}
              placeholder="Why is this being rejected? (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={reject} disabled={pending} variant="destructive">
                {pending ? "Rejecting…" : "Confirm reject"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setMode("idle");
                  setReason("");
                }}
                disabled={pending}
              >
                Back
              </Button>
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            <Button onClick={approve} disabled={pending}>
              {pending ? "Working…" : "Approve & complete"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setMode("reject")}
              disabled={pending}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ASSIGNED or REJECTED — assigner can cancel.
  return (
    <div className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
      <div className="text-[12px] font-medium text-ik-ink-2">Assigner controls</div>
      {mode === "cancel" ? (
        <>
          <Textarea
            rows={2}
            placeholder="Cancellation note (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button onClick={cancel} disabled={pending} variant="destructive">
              {pending ? "Cancelling…" : "Confirm cancel"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setMode("idle");
                setReason("");
              }}
              disabled={pending}
            >
              Back
            </Button>
          </div>
        </>
      ) : (
        <Button variant="outline" onClick={() => setMode("cancel")}>
          Cancel task
        </Button>
      )}
    </div>
  );
}
