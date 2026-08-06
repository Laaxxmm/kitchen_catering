"use client";

import { useState } from "react";
import { ChefRequisitionLineStatus } from "@prisma/client";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { useCall } from "./DraftEditControls";
import { decideAmend } from "./amend-rules";

// The order was revised after the requisition went to the store. The chef
// raises the number on the line they need more of; the store then issues only
// the difference against that same line. Server re-checks all of this — the
// shared decideAmend keeps the button from offering what it would refuse.

interface Props {
  lineId: string;
  requestedQty: string;
  issuedQty: string;
  unit: string;
  status: ChefRequisitionLineStatus;
  onAmend: (lineId: string, qty: string, reason: string) => Promise<ActionResult>;
}

export function AmendQtyControl({ lineId, requestedQty, issuedQty, unit, status, onAmend }: Props) {
  const { pending, call } = useCall();
  const [qty, setQty] = useState(requestedQty);
  const [reason, setReason] = useState("");

  const decision = decideAmend({ currentQty: requestedQty, newQty: qty, issuedQty, lineStatus: status });
  const dirty = qty.trim() !== "" && qty.trim() !== requestedQty;
  const owed = decision.ok ? new Decimal(decision.qty).minus(new Decimal(issuedQty)) : null;
  const issued = new Decimal(issuedQty);

  return (
    <div className="flex flex-col gap-1 text-[12.5px]">
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="any"
          min="0.001"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="h-8 w-20 rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
          aria-label="New requested quantity"
        />
        <span className="text-ik-ink-3">
          {unit} · {issued.toString()} issued
        </span>
      </div>
      {dirty && (
        <>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? (e.g. order revised to 20 pax)"
            className="h-8 w-56 rounded border border-ik-rule bg-ik-card px-2"
            aria-label="Reason for the change"
          />
          {decision.ok ? (
            <span className="text-[11px] text-ik-ink-3">
              {owed && owed.gt(0)
                ? `The store will issue ${owed.toString()} ${unit} more against this line.`
                : "Nothing further to issue on this line."}
              {status === ChefRequisitionLineStatus.AWAITING_PROCUREMENT &&
                " A purchase order is already out for this item — the store will need to top it up."}
            </span>
          ) : (
            <span className="text-[11px] text-alert">{decision.error}</span>
          )}
          <span className="flex gap-1">
            <Button
              type="button"
              size="sm"
              disabled={pending || !decision.ok || !reason.trim()}
              onClick={() =>
                call(
                  () => onAmend(lineId, qty.trim(), reason.trim()),
                  () => setReason(""),
                  owed && owed.gt(0)
                    ? `Requested ${qty.trim()} ${unit} — the store now owes you ${owed.toString()} ${unit}`
                    : "Quantity updated",
                )
              }
            >
              Save qty
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setQty(requestedQty);
                setReason("");
              }}
            >
              Undo
            </Button>
          </span>
        </>
      )}
    </div>
  );
}
