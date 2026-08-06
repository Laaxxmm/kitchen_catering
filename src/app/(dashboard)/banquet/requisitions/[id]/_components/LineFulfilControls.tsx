"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BanquetRequisitionLineStatus } from "@prisma/client";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";
import { planBanquetLineAmend } from "./amend-qty";

interface Props {
  lineId: string;
  itemName: string;
  unit: string;
  requestedQty: string;
  issuedQty: string;
  inStock: string;
  status: BanquetRequisitionLineStatus;
  /** The PO already buying this line's shortfall, if one was raised. */
  poLink: { poId: string; poNo: string } | null;
  onIssue: (lineId: string, qty: string) => Promise<ActionResult>;
  onSendToProcurement: (lineId: string, reason: string) => Promise<ActionResult>;
  onCancel: (lineId: string, reason: string) => Promise<ActionResult>;
  onAmendQty: (lineId: string, newQty: string, reason: string) => Promise<ActionResult>;
}

export function LineFulfilControls({
  lineId,
  itemName,
  unit,
  requestedQty,
  issuedQty,
  inStock,
  status,
  poLink,
  onIssue,
  onSendToProcurement,
  onCancel,
  onAmendQty,
}: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [showPartial, setShowPartial] = useState(false);
  const [partialQty, setPartialQty] = useState("");
  const [showAmend, setShowAmend] = useState(false);
  const [amendQty, setAmendQty] = useState(requestedQty);
  const [amendReason, setAmendReason] = useState("");

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

  function call(fn: () => Promise<ActionResult>, successMsg?: string) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success(successMsg ?? "Saved");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  // Order revised (10 → 20 pax): raise the ask on THIS line and the store
  // issues only the difference. Hidden exactly where the server refuses —
  // cancelled, or a PO already out at the old quantity.
  const amendPlan = planBanquetLineAmend({ requestedQty, issuedQty, newQty: amendQty, unit, lineStatus: status });
  // The box opens pre-filled with the current qty, which is a legitimate
  // refusal ("already requesting 5") — don't shout it before they've typed.
  const amendTouched = amendQty !== requestedQty;
  const canAmend =
    status !== BanquetRequisitionLineStatus.CANCELLED &&
    status !== BanquetRequisitionLineStatus.AWAITING_PROCUREMENT;
  const amendControl = !canAmend ? null : !showAmend ? (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setShowAmend(true)}>
      Change qty…
    </Button>
  ) : (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1">
        <input
          type="number"
          step="any"
          min="0.001"
          value={amendQty}
          onChange={(e) => setAmendQty(e.target.value)}
          className={
            "h-7 w-24 rounded border bg-ik-card px-1 text-right font-mono " +
            (amendPlan.ok || !amendTouched ? "border-ik-rule" : "border-alert")
          }
        />
        <span className="text-[10.5px] text-ik-ink-3">
          {unit} · {issuedQty} already issued
        </span>
        <input
          type="text"
          placeholder="Reason (required)"
          value={amendReason}
          onChange={(e) => setAmendReason(e.target.value)}
          className="h-7 w-40 rounded border border-ik-rule bg-ik-card px-1"
        />
        <Button
          type="button"
          size="sm"
          disabled={pending || !amendPlan.ok || !amendReason.trim()}
          onClick={() =>
            call(
              () => onAmendQty(lineId, amendQty, amendReason.trim()),
              `${itemName} changed to ${amendQty} ${unit} — the store has been told`,
            )
          }
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setShowAmend(false);
            setAmendQty(requestedQty);
            setAmendReason("");
          }}
        >
          Cancel
        </Button>
      </span>
      {!amendPlan.ok && amendTouched && (
        <span className="text-[10.5px] text-alert">{amendPlan.error}</span>
      )}
    </span>
  );

  if (status === BanquetRequisitionLineStatus.ISSUED || status === BanquetRequisitionLineStatus.CANCELLED) {
    // Fully issued still amends — that's how the extra five get requested.
    return amendControl ?? <span className="text-[12px] text-ik-ink-3">—</span>;
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
      <div className="flex flex-wrap items-center gap-1">
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
                Nothing in stock — flag it for a purchase order instead
              </span>
            )}
          </span>
        )}
        {wasAwaitingProcurement && poLink && (
          <Link
            href={`/procurement/purchase-orders/${poLink.poId}`}
            className="text-[11.5px] font-medium text-ik-accent underline underline-offset-2"
          >
            PO raised ({poLink.poNo}) →
          </Link>
        )}
        {amendControl}
        {/* Flag only — the PO itself is raised from the header link, one
            vendor for every flagged line (same route as the kitchen). */}
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
            the rest of the requisition still issues and rolls up instead of
            freezing here. */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          className="border-alert/40 text-alert hover:bg-alert-wash"
          onClick={() => {
            const reason = prompt(
              "Cancel this item — why can't it be provided? (e.g. discontinued, client removed it)",
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
