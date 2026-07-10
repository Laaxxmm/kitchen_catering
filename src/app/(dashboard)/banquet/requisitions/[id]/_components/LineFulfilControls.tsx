"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BanquetRequisitionLineStatus } from "@prisma/client";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  lineId: string;
  requestedQty: string;
  issuedQty: string;
  inStock: string;
  status: BanquetRequisitionLineStatus;
  onIssue: (lineId: string, qty: string) => Promise<ActionResult>;
  onSendToProcurement: (lineId: string, reason: string) => Promise<ActionResult>;
}

export function LineFulfilControls({ lineId, requestedQty, issuedQty, inStock, status, onIssue, onSendToProcurement }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [showPartial, setShowPartial] = useState(false);
  const [partialQty, setPartialQty] = useState("");

  const remaining = new Decimal(requestedQty).minus(new Decimal(issuedQty));
  const stockDec = new Decimal(inStock);
  const fullPossible = stockDec.gte(remaining) && remaining.gt(0);
  // Never issue more than what's on hand OR still requested. Used to guard the
  // button and render an inline "exceeds available" hint rather than letting
  // the server action throw (production masks the friendly message).
  const maxIssuable = Decimal.min(stockDec, remaining);
  const partialQtyDec = partialQty ? new Decimal(partialQty || "0") : new Decimal(0);
  const partialValid = partialQty !== "" && partialQtyDec.gt(0) && partialQtyDec.lte(maxIssuable);
  const partialOverIssue = partialQty !== "" && partialQtyDec.gt(maxIssuable);

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

  if (status === BanquetRequisitionLineStatus.ISSUED || status === BanquetRequisitionLineStatus.CANCELLED) {
    return <span className="text-[12px] text-ik-ink-3">—</span>;
  }

  const wasAwaitingProcurement = status === BanquetRequisitionLineStatus.AWAITING_PROCUREMENT;
  const stockIsBack = stockDec.gt(0);

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
            disabled={stockDec.lte(0)}
            title={stockDec.lte(0) ? "Nothing in stock — raise a PO" : undefined}
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
            {stockDec.lte(0) && (
              <span className="text-[10.5px] text-ik-ink-3">
                Nothing in stock — raise a PO for the shortfall instead
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
              const reason = prompt("Why does this need buying? (e.g. not enough in stock)") ?? "";
              call(() => onSendToProcurement(lineId, reason.trim()));
            }}
          >
            Raise PO for shortfall
          </Button>
        )}
      </div>
    </div>
  );
}
