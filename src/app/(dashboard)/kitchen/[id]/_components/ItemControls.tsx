"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProductionJobItemStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { isNextNavigationError } from "@/lib/next-error";

interface Props {
  itemId: string;
  status: ProductionJobItemStatus;
  onStart: (itemId: string) => Promise<ActionResult>;
  onReady: (itemId: string) => Promise<ActionResult>;
}

/**
 * Per-item action button on the kitchen production job. We dropped the
 * "assign chef" dropdown — the chef is recorded automatically on the
 * first Start click (see startProductionItem in production-jobs.ts).
 *
 * QUEUED  → "Start"          → IN_PROGRESS
 * IN_PROGRESS → "Mark ready" → READY
 * READY / CANCELLED → no actions
 */
export function ItemControls({ itemId, status, onStart, onReady }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function call(fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
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

  if (status === ProductionJobItemStatus.READY || status === ProductionJobItemStatus.CANCELLED) {
    return <span className="text-[12px] text-ik-ink-3">—</span>;
  }
  if (status === ProductionJobItemStatus.QUEUED) {
    return (
      <Button size="sm" disabled={pending} onClick={() => call(() => onStart(itemId))}>
        Start cooking
      </Button>
    );
  }
  return (
    <Button size="sm" disabled={pending} onClick={() => call(() => onReady(itemId))}>
      Mark ready
    </Button>
  );
}
