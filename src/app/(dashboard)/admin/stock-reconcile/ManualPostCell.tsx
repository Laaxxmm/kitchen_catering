"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postReconcileLineManual } from "@/server/actions/reconcile-grn-stock";

/**
 * Inline "post this line" for a flagged GRN line. Defaults to the quantity and
 * unit that were actually bought (a one-click re-base to the purchase unit);
 * the admin edits either when the catalogue unit needs a real conversion. The
 * rupee value of the receipt is preserved server-side whatever unit is chosen.
 */
export function ManualPostCell({
  grnLineId,
  defaultQty,
  defaultUnit,
}: {
  grnLineId: string;
  defaultQty: string;
  defaultUnit: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [qty, setQty] = useState(defaultQty);
  const [unit, setUnit] = useState(defaultUnit);

  function post() {
    if (!(Number(qty) > 0)) {
      toast.error("Enter a quantity greater than zero");
      return;
    }
    startTransition(async () => {
      const res = await postReconcileLineManual({ grnLineId, quantity: qty, unit });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Posted to stock");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        inputMode="decimal"
        className="h-8 w-20 text-[12.5px]"
        aria-label="Quantity to post"
      />
      <Input
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        className="h-8 w-20 text-[12.5px]"
        aria-label="Unit to post in"
      />
      <Button size="sm" disabled={pending} onClick={post}>{pending ? "…" : "Post"}</Button>
    </div>
  );
}
