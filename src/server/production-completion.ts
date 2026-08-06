import {
  OrderStatus,
  ProductionJobItemStatus,
  ProductionJobStatus,
} from "@prisma/client";

/**
 * Pure decision logic for "this cooking job is finished". Lives outside
 * `production-jobs.ts` because that file is `"use server"` — every export
 * there must be an async server action, so a plain function can't live in it.
 *
 * The point of splitting the two `advance*` flags apart: the job row and the
 * order row are advanced by INDEPENDENT guarded writes. Whether the job row
 * happened to change on this click must never decide whether the order
 * advances — that coupling is what left order ORD-26-27-0085 stuck in IN_PREP
 * behind a job that was already READY.
 */

/** Job statuses a finished job may advance to READY from (never rewinds). */
export const JOB_ADVANCE_FROM: ProductionJobStatus[] = [
  ProductionJobStatus.QUEUED,
  ProductionJobStatus.PREP,
  ProductionJobStatus.COOKING,
];

/** Order statuses a cooked order may advance to READY from (never rewinds). */
export const ORDER_ADVANCE_FROM: OrderStatus[] = [
  OrderStatus.READY_FOR_PRODUCTION,
  OrderStatus.IN_PREP,
];

export interface ProductionCompletion {
  /** Every live (non-CANCELLED) item is READY, and there is at least one. */
  allItemsReady: boolean;
  /** Flip the job row to READY. */
  advanceJob: boolean;
  /** Flip the order row to READY — independent of `advanceJob`. */
  advanceOrder: boolean;
}

/**
 * Given the real state of a job, decide what should move. CANCELLED items are
 * ignored (a cancelled dish can't hold an order back); a job with no live
 * items at all advances nothing — there is nothing that was cooked.
 */
export function productionCompletion(
  itemStatuses: ProductionJobItemStatus[],
  jobStatus: ProductionJobStatus,
  orderStatus: OrderStatus,
): ProductionCompletion {
  const live = itemStatuses.filter((s) => s !== ProductionJobItemStatus.CANCELLED);
  const allItemsReady =
    live.length > 0 && live.every((s) => s === ProductionJobItemStatus.READY);
  return {
    allItemsReady,
    advanceJob: allItemsReady && JOB_ADVANCE_FROM.includes(jobStatus),
    advanceOrder: allItemsReady && ORDER_ADVANCE_FROM.includes(orderStatus),
  };
}
