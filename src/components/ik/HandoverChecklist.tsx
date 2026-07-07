"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProductionJobItemStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { formatIST } from "@/lib/time";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";
import {
  markAllItemsHandedOver,
  markItemHandedOver,
} from "@/server/actions/production-jobs";

export interface HandoverChecklistItem {
  id: string;
  dishName: string;
  portions: string;
  status: ProductionJobItemStatus;
  /** ISO timestamp — set the moment the dish was physically handed over. */
  handedOverAt: string | null;
  handedOverBy: string | null;
}

interface Props {
  jobId: string;
  items: HandoverChecklistItem[];
  /** Tighter paddings for board cards. */
  compact?: boolean;
  /** Hide the action buttons for viewers who can't hand over (the server
   *  gates anyway — this just avoids dead buttons for e.g. sales). */
  readOnly?: boolean;
}

const WAITING_LABEL: Partial<Record<ProductionJobItemStatus, string>> = {
  [ProductionJobItemStatus.QUEUED]: "queued",
  [ProductionJobItemStatus.IN_PROGRESS]: "cooking",
};

/**
 * Kitchen → delivery handover checklist. Each dish is ticked "Handed over"
 * at the moment it's physically given to the delivery team — timestamp +
 * who — so a late dish is attributable to the kitchen, not the driver. The
 * order-level handover completes automatically (server-side) when the last
 * item is ticked.
 */
export function HandoverChecklist({ jobId, items, compact = false, readOnly = false }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Cancelled dishes never go out — they don't count towards progress.
  const live = items.filter((it) => it.status !== ProductionJobItemStatus.CANCELLED);
  const handed = live.filter((it) => it.handedOverAt);
  const notHanded = live.filter((it) => !it.handedOverAt);
  const allHanded = live.length > 0 && notHanded.length === 0;
  const allReadyNoneHanded =
    handed.length === 0 &&
    live.length > 0 &&
    live.every((it) => it.status === ProductionJobItemStatus.READY);
  const lastHandedAt = allHanded
    ? handed.reduce<string>((max, it) => (it.handedOverAt! > max ? it.handedOverAt! : max), handed[0].handedOverAt!)
    : null;

  function run(fn: () => Promise<ActionResult>, msg: string) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(msg);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  if (live.length === 0) return null;

  return (
    <div className={"rounded-md border border-ik-rule bg-ik-card " + (compact ? "p-2" : "p-3")}>
      {/* Progress line */}
      {allHanded ? (
        <div className="text-[12px] font-medium text-positive">
          ✓ All items handed to delivery at{" "}
          <span className="font-mono">{formatIST(new Date(lastHandedAt!), "HH:mm")}</span>
        </div>
      ) : (
        <div className="text-[12px] text-ik-ink-2">
          <span className="font-medium text-ik-ink">
            {handed.length} of {live.length}
          </span>{" "}
          handed over
          {notHanded.length > 0 && (
            <>
              {" — "}
              {notHanded.length === 1 ? "last pending" : "pending"}:{" "}
              <span className="font-medium text-ik-ink">
                {notHanded.slice(0, 2).map((it) => it.dishName).join(", ")}
                {notHanded.length > 2 ? ` +${notHanded.length - 2} more` : ""}
              </span>
            </>
          )}
        </div>
      )}

      {/* Item rows */}
      <ul className={"grid gap-1 " + (compact ? "mt-1.5" : "mt-2")}>
        {items.map((it) => {
          const cancelled = it.status === ProductionJobItemStatus.CANCELLED;
          const ready = it.status === ProductionJobItemStatus.READY;
          return (
            <li
              key={it.id}
              className={
                "flex items-center justify-between gap-2 rounded border border-ik-rule px-2 py-1.5 text-[12px] " +
                (it.handedOverAt ? "bg-positive/5" : "bg-ik-paper-alt")
              }
            >
              <div className="min-w-0 flex-1">
                <span className={"truncate " + (cancelled ? "text-ik-ink-3 line-through" : "text-ik-ink")}>
                  {it.dishName}
                </span>{" "}
                <span className="font-mono text-[11px] text-ik-ink-3">{it.portions}</span>
              </div>
              {it.handedOverAt ? (
                <span className="shrink-0 whitespace-nowrap text-[11.5px] font-medium text-positive">
                  ✓ <span className="font-mono">{formatIST(new Date(it.handedOverAt), "HH:mm")}</span>
                  {it.handedOverBy && <span className="text-ik-ink-2"> · by {it.handedOverBy}</span>}
                </span>
              ) : ready && !readOnly ? (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => markItemHandedOver(it.id), `${it.dishName} handed over`)}
                >
                  Handed over ✓
                </Button>
              ) : ready ? (
                <span className="shrink-0 whitespace-nowrap text-[11px] text-ik-ink-3">
                  ready — not handed over yet
                </span>
              ) : (
                <span className="shrink-0 whitespace-nowrap text-[11px] text-ik-ink-3">
                  {cancelled
                    ? "cancelled"
                    : `${WAITING_LABEL[it.status] ?? it.status.toLowerCase()} · waiting on kitchen`}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Everything goes out together — one tap, one timestamp. */}
      {allReadyNoneHanded && !readOnly && (
        <div className={compact ? "mt-1.5" : "mt-2"}>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() => markAllItemsHandedOver(jobId), "All items handed to delivery")
            }
          >
            All ready — hand over everything
          </Button>
        </div>
      )}
    </div>
  );
}
