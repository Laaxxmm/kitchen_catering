"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import { allocateOrderFeedback } from "@/server/actions/orders";

interface Props {
  orderId: string;
  canAllocate: boolean;
  assigneeName: string | null;
  rating: number | null;
  comment: string | null;
  users: { id: string; name: string }[];
}

/**
 * "Who's collecting the customer's feedback?" — a manager allocates a staff
 * member (creating a tracked task for them). Shows the current assignee and
 * any feedback the customer has already left.
 */
export function FeedbackAllocation({ orderId, canAllocate, assigneeName, rating, comment, users }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assigneeId, setAssigneeId] = useState(users[0]?.id ?? "");
  const [open, setOpen] = useState(false);

  function allocate() {
    if (!assigneeId) return toast.error("Pick a person");
    startTransition(async () => {
      try {
        const res = await allocateOrderFeedback(orderId, assigneeId);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Feedback collection assigned");
        setOpen(false);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not assign");
      }
    });
  }

  return (
    <div className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px]">
      <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Customer feedback</h3>

      {rating != null ? (
        <div className="mb-2">
          <div className="text-ik-ink">Rating: <strong>{rating}/5</strong></div>
          {comment && <div className="mt-1 rounded bg-ik-paper-alt p-2 text-[12.5px] text-ik-ink-2">{comment}</div>}
        </div>
      ) : (
        <p className="mb-2 text-[12.5px] text-ik-ink-3">No feedback recorded yet.</p>
      )}

      <div className="text-[12.5px] text-ik-ink-2">
        {assigneeName
          ? <>Collection assigned to <strong>{assigneeName}</strong>.</>
          : <>No one is assigned to collect it yet.</>}
      </div>

      {canAllocate && (
        <div className="mt-2.5">
          {open ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
              >
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <Button size="sm" disabled={pending} onClick={allocate}>{pending ? "Assigning…" : "Assign"}</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              {assigneeName ? "Reassign" : "Allocate someone"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
