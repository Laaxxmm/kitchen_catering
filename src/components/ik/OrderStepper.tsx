import { OrderStatus } from "@prisma/client";
import { STAGE_FLOW, STATUS_LABEL, effectiveStageStatus } from "@/lib/order-status";

interface Props {
  current: OrderStatus;
  /** In-house immediate channels skip the admin gate — drop that step. */
  immediate?: boolean;
}

/**
 * Horizontal flow stepper showing all 11 happy-path stages with the current
 * one highlighted. Branch states (CHANGES_PROPOSED_BY_CHEF, REJECTED_BY_MANAGER,
 * CANCELLED) are surfaced as an inline annotation under the stepper.
 *
 * Visual:
 *   ● Draft ── ● Chef review ── ◉ Requisition ── ○ Issuing ── …
 *                                  ↑ current
 */
export function OrderStepper({ current, immediate }: Props) {
  // Immediate in-house orders never pass through admin review, so leave
  // that stage off the line entirely.
  const flow = immediate
    ? STAGE_FLOW.filter((s) => s.status !== OrderStatus.PENDING_ADMIN_APPROVAL)
    : STAGE_FLOW;
  const activeStatus = effectiveStageStatus(current);
  const activeIdx = activeStatus ? flow.findIndex((s) => s.status === activeStatus) : -1;
  const isCancelled = current === OrderStatus.CANCELLED;
  const isRejected = current === OrderStatus.REJECTED_BY_MANAGER;
  const isChanges = current === OrderStatus.CHANGES_PROPOSED_BY_CHEF;

  return (
    <div className="rounded-md border border-ik-rule bg-ik-card p-4">
      {/* Horizontal scroll on small screens so the steps don't crush */}
      <div className="overflow-x-auto">
        <ol className="flex min-w-max items-center gap-0">
          {STAGE_FLOW.map((s, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            const upcoming = i > activeIdx;
            return (
              <li key={s.status} className="flex items-center">
                <div className="flex flex-col items-center px-2">
                  <div
                    className={
                      "flex h-7 w-7 items-center justify-center rounded-full border-2 font-mono text-[11px] " +
                      (done
                        ? "border-brand-500 bg-brand-500 text-white"
                        : active
                          ? "border-brand-500 bg-ik-card text-brand-700 ring-2 ring-brand-200"
                          : "border-ik-rule bg-ik-card text-ik-ink-3")
                    }
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <div
                    className={
                      "mt-1 whitespace-nowrap text-[10.5px] " +
                      (active ? "font-medium text-ik-ink" : upcoming ? "text-ik-ink-3" : "text-ik-ink-2")
                    }
                  >
                    {s.short}
                  </div>
                </div>
                {i < STAGE_FLOW.length - 1 && (
                  <div
                    className={
                      "h-[2px] w-8 " + (done ? "bg-brand-500" : "bg-ik-rule")
                    }
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Branch annotation under the line */}
      <div className="mt-3 flex items-center gap-2 text-[12.5px]">
        <span className="text-ik-ink-3">Current status:</span>
        {isChanges && (
          <span className="rounded-full bg-amber-wash px-2 py-0.5 font-medium text-amber">
            {STATUS_LABEL[current]}
          </span>
        )}
        {isRejected && (
          <span className="rounded-full bg-alert-wash px-2 py-0.5 font-medium text-alert">
            {STATUS_LABEL[current]}
          </span>
        )}
        {isCancelled && (
          <span className="rounded-full bg-alert-wash px-2 py-0.5 font-medium text-alert">
            Cancelled
          </span>
        )}
        {!isChanges && !isRejected && !isCancelled && (
          <span className="font-medium text-ik-ink">{STATUS_LABEL[current]}</span>
        )}
      </div>
    </div>
  );
}
