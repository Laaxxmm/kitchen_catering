"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChefRequisitionLineStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Decimal } from "decimal.js";
import { isNextNavigationError } from "@/lib/next-error";

interface Props {
  lineId: string;
  requestedQty: string;
  issuedQty: string;
  onHand: string;
  status: ChefRequisitionLineStatus;
  onIssue: (lineId: string, qty: string) => Promise<void>;
  onSendToProcurement: (lineId: string, reason: string) => Promise<void>;
}

export function LineFulfilControls({ lineId, requestedQty, issuedQty, onHand, status, onIssue, onSendToProcurement }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [showPartial, setShowPartial] = useState(false);
  const [partialQty, setPartialQty] = useState("");

  const remaining = new Decimal(requestedQty).minus(new Decimal(issuedQty));
  const onHandDec = new Decimal(onHand);
  const fullPossible = onHandDec.gte(remaining) && remaining.gt(0);
  // Cap how much partial-issue can be: never more than what's on hand
  // OR what's still requested. Used both to guard the Issue button and
  // to render an inline "exceeds available" hint instead of letting
  // the server action throw (which production-masks the friendly
  // "Insufficient stock" message into the generic Server Components
  // render error).
  const maxIssuable = Decimal.min(onHandDec, remaining);
  const partialQtyDec = partialQty ? new Decimal(partialQty || "0") : new Decimal(0);
  const partialValid =
    partialQty !== "" && partialQtyDec.gt(0) && partialQtyDec.lte(maxIssuable);
  const partialOverIssue =
    partialQty !== "" && partialQtyDec.gt(maxIssuable);

  function call(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        toast.success("Saved");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  if (status === ChefRequisitionLineStatus.ISSUED || status === ChefRequisitionLineStatus.CANCELLED) {
    return <span className="text-[12px] text-ik-ink-3">—</span>;
  }

  // Lines previously sent to procurement can still be issued once stock
  // is back. Show an amber "Procurement" badge alongside the issue
  // buttons so the storekeeper knows the line was originally flagged.
  const wasAwaitingProcurement = status === ChefRequisitionLineStatus.AWAITING_PROCUREMENT;

  return (
    <div className="flex flex-col gap-1 text-[12.5px]">
      {wasAwaitingProcurement && (
        <span className="self-start rounded-full bg-amber-wash px-2 py-0.5 text-[10.5px] font-medium text-amber">
          Was sent to procurement — stock is back, you can issue now
        </span>
      )}
      <div className="flex flex-wrap gap-1">
        {fullPossible && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => call(() => onIssue(lineId, remaining.toString()))}
          >
            Issue full ({remaining.toString()})
          </Button>
        )}
        {!showPartial ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={onHandDec.lte(0)}
            title={onHandDec.lte(0) ? "Nothing in stock — send to procurement" : undefined}
            onClick={() => setShowPartial(true)}
          >
            Issue partial…
          </Button>
        ) : (
          <span className="flex flex-col gap-0.5">
            <span className="flex gap-1">
              <input
                type="number"
                step="0.001"
                min="0.001"
                max={Math.max(maxIssuable.toNumber(), 0)}
                placeholder={`max ${maxIssuable.toString()}`}
                value={partialQty}
                onChange={(e) => setPartialQty(e.target.value)}
                className={
                  "h-7 w-24 rounded border bg-ik-card px-1 text-right font-mono " +
                  (partialOverIssue ? "border-alert" : "border-ik-rule")
                }
              />
              <Button
                type="button"
                size="sm"
                disabled={pending || !partialValid}
                onClick={() => call(() => onIssue(lineId, partialQty))}
              >
                Issue
              </Button>
            </span>
            {partialOverIssue && (
              <span className="text-[10.5px] text-alert">
                Exceeds available ({maxIssuable.toString()})
              </span>
            )}
            {onHandDec.lte(0) && (
              <span className="text-[10.5px] text-ik-ink-3">
                Nothing in stock — send to procurement instead
              </span>
            )}
          </span>
        )}
        {!wasAwaitingProcurement && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              const reason = prompt("Reason for sending to procurement?");
              if (reason && reason.trim()) call(() => onSendToProcurement(lineId, reason.trim()));
            }}
          >
            Send to procurement
          </Button>
        )}
      </div>
    </div>
  );
}
