"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PaymentMethod } from "@prisma/client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

/**
 * Modal triggered by the "Mark paid" button on the customer-invoice
 * detail page. Replaces the old one-click which defaulted method=OTHER
 * and left the reference blank (image 1 from the client's workflow doc
 * flagged exactly that gap).
 *
 * Caller supplies an async submit fn that wraps `markCustomerInvoicePaid`
 * — keeps the server-action call site server-side (in the page) while
 * the modal lives client-side.
 */
interface Props {
  outstanding: string;
  onSubmit: (input: {
    method: PaymentMethod;
    reference: string | null;
    paidAt: string;
    notes: string | null;
  }) => Promise<ActionResult | void>;
}

function defaultPaidAt(): string {
  // datetime-local needs YYYY-MM-DDTHH:MM with no seconds/ms or tz.
  const d = new Date();
  d.setSeconds(0, 0);
  // Local timezone offset is implicit in the input control.
  return d.toISOString().slice(0, 16);
}

export function MarkPaidModal({ outstanding, onSubmit }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(defaultPaidAt());
  const [notes, setNotes] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reference.trim().length === 0 && method !== PaymentMethod.CASH) {
      // Per the Workflow doc the reference should always be captured.
      // Cash is the one exception — there isn't always an external ref.
      toast.error(
        "Reference is required (UPI ref / cheque no / NEFT ref). Use Cash if no reference applies.",
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await onSubmit({
          method,
          reference: reference.trim() || null,
          paidAt,
          notes: notes.trim() || null,
        });
        if (res && !res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Marked paid");
        setOpen(false);
        // Reset for the next time the modal opens.
        setReference("");
        setNotes("");
        setMethod(PaymentMethod.UPI);
        setPaidAt(defaultPaidAt());
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Mark paid failed");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Mark paid
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Mark invoice paid"
        description={
          <>
            Closes the remaining balance of <strong>₹{outstanding}</strong> with
            one payment row. For partial payments use the &ldquo;Record
            payment&rdquo; form below the line items.
          </>
        }
      >
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="mp-method">Payment method</Label>
              <select
                id="mp-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
              >
                {Object.values(PaymentMethod).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="mp-paidAt">Paid at</Label>
              <Input
                id="mp-paidAt"
                type="datetime-local"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="mp-reference">
              Reference{" "}
              {method !== PaymentMethod.CASH && (
                <span className="text-alert">*</span>
              )}
            </Label>
            <Input
              id="mp-reference"
              placeholder="UPI ref / cheque no / NEFT ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            {method === PaymentMethod.CASH && (
              <span className="text-[11px] text-ik-ink-3">
                Optional for cash. Skip if no receipt number.
              </span>
            )}
          </div>

          <div className="grid gap-1">
            <Label htmlFor="mp-notes">Notes (optional)</Label>
            <Input
              id="mp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Mark paid"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
