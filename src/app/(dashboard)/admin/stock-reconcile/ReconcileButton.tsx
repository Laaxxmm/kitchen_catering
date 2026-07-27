"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyGrnStockReconcile } from "@/server/actions/reconcile-grn-stock";

/** One-click "post the safe ones". Confirms first — it writes stock. */
export function ReconcileButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);

  function run() {
    startTransition(async () => {
      const res = await applyGrnStockReconcile();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Posted ${res.posted} line${res.posted === 1 ? "" : "s"} to stock${res.skipped ? ` · ${res.skipped} skipped` : ""}.`);
      setArmed(false);
      router.refresh();
    });
  }

  if (!armed) {
    return (
      <Button disabled={disabled || pending} onClick={() => setArmed(true)}>
        Post received stock
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button disabled={pending} onClick={run}>{pending ? "Posting…" : "Confirm — post now"}</Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setArmed(false)}>Cancel</Button>
    </div>
  );
}
