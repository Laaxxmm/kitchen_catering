"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChefRequisitionLineStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Decimal } from "decimal.js";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  lineId: string;
  requestedQty: string;
  issuedQty: string;
  onHand: string;
  status: ChefRequisitionLineStatus;
  onIssue: (lineId: string, qty: string) => Promise<ActionResult>;
  onSendToProcurement: (lineId: string, reason: string) => Promise<ActionResult>;
  onCancel: (lineId: string, reason: string) => Promise<ActionResult>;
}

export function LineFulfilControls({ lineId, requestedQty, issuedQty, onHand, status, onIssue, onSendToProcurement, onCancel }: Props) {
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

  function call(fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
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

  // Lines previously sent to procurement. The badge text must match
  // reality: only say "you can issue now" once stock has actually come
  // back in (on hand > 0). While on hand is still 0 the line is genuinely
  // waiting on the supplier — saying "stock is back" there was confusing.
  const wasAwaitingProcurement = status === ChefRequisitionLineStatus.AWAITING_PROCUREMENT;
  const stockIsBack = onHandDec.gt(0);

  return (
    <div className="flex flex-col gap-1 text-[12.5px]">
      {wasAwaitingProcurement && (
        stockIsBack ? (
          <span className="self-start rounded-full bg-positive-wash px-2 py-0.5 text-[10.5px] font-medium text-positive">
            Stock has arrived — you can issue this line now
          </span>
        ) : (
          <span className="self-start rounded-full bg-amber-wash px-2 py-0.5 text-[10.5px] font-medium text-amber">
            Waiting on procurement — no stock in yet
          </span>
        )
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
                step="any"
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
                Nothing in stock — flag it for a purchase order instead
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
              const reason = prompt("Why does this need buying? (e.g. not enough in stock)");
              if (reason && reason.trim()) call(() => onSendToProcurement(lineId, reason.trim()));
            }}
          >
            Out of stock — needs PO
          </Button>
        )}
        {/* Can't-provide escape hatch: cancel this one item with a reason so
            the rest of the requisition still issues and the order proceeds to
            the kitchen instead of freezing here. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          className="border-alert/40 text-alert hover:bg-alert-wash"
          onClick={() => {
            const reason = prompt(
              "Cancel this item — why can't it be provided? (e.g. discontinued, client removed the dish)",
            );
            if (reason && reason.trim()) call(() => onCancel(lineId, reason.trim()));
          }}
        >
          Cancel item
        </Button>
      </div>
    </div>
  );
}
