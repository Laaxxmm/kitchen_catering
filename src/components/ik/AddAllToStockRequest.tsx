"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import { createLowStockRequisition } from "@/server/actions/review";

/**
 * Shared "create one stock request for every below-reorder ingredient"
 * button — used by both the Review worklist and the Stock page so the two
 * stay in lock-step. Navigates to the freshly-created draft PR.
 */
export function AddAllToStockRequest({ count, label }: { count: number; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const { id } = await createLowStockRequisition();
        toast.success("Stock request created");
        router.push(`/procurement/purchase-requisitions/${id}`);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not create request");
      }
    });
  }

  return (
    <Button size="sm" disabled={pending} onClick={run}>
      {label ?? `Add all ${count} to stock request`}
    </Button>
  );
}
