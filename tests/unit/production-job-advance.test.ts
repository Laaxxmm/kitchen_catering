import { describe, expect, it } from "vitest";
import {
  OrderStatus,
  ProductionJobItemStatus,
  ProductionJobStatus,
} from "@prisma/client";
import {
  JOB_ADVANCE_FROM,
  ORDER_ADVANCE_FROM,
  productionCompletion,
} from "@/server/production-completion";

/**
 * Order ORD-26-27-0085 sat 223 hours late because the ORDER advance was
 * nested inside "did the JOB row change on this click". Every dish was
 * ticked, the job read READY, and the order was still IN_PREP — invisible to
 * dispatch, unmovable from any screen.
 *
 * These guard the decision that replaced it: job and order are judged
 * SEPARATELY, both from the real item rows, so whichever one lags behind gets
 * picked up the next time anyone touches the job.
 */

const { QUEUED, IN_PROGRESS, READY, CANCELLED } = ProductionJobItemStatus;

/** Shorthand: decide with the job/order still mid-production. */
function cooking(items: ProductionJobItemStatus[]) {
  return productionCompletion(items, ProductionJobStatus.COOKING, OrderStatus.IN_PREP);
}

describe("productionCompletion — when the job is finished", () => {
  it("advances both when every item is ready", () => {
    const d = cooking([READY, READY, READY]);
    expect(d.allItemsReady).toBe(true);
    expect(d.advanceJob).toBe(true);
    expect(d.advanceOrder).toBe(true);
  });

  it("advances nothing while one dish is still pending", () => {
    for (const pending of [QUEUED, IN_PROGRESS]) {
      const d = cooking([READY, pending, READY]);
      expect(d.allItemsReady).toBe(false);
      expect(d.advanceJob).toBe(false);
      expect(d.advanceOrder).toBe(false);
    }
  });

  it("ignores CANCELLED dishes — the rest being ready is enough", () => {
    // A dish dropped from the order must not hold the whole order hostage.
    const d = cooking([READY, CANCELLED, READY, CANCELLED]);
    expect(d.allItemsReady).toBe(true);
    expect(d.advanceOrder).toBe(true);
  });

  it("advances nothing for an empty or fully-cancelled job", () => {
    // Nothing was cooked, so "everything is ready" is vacuously true and must
    // NOT be treated as done — otherwise a cancelled order flips to READY.
    for (const items of [[], [CANCELLED], [CANCELLED, CANCELLED]]) {
      const d = cooking(items);
      expect(d.allItemsReady).toBe(false);
      expect(d.advanceJob).toBe(false);
      expect(d.advanceOrder).toBe(false);
    }
  });
});

describe("productionCompletion — idempotency (the ORD-26-27-0085 bug)", () => {
  it("still advances the ORDER when the job is ALREADY READY", () => {
    // The exact production state: job READY, every dish ticked, order left
    // behind in IN_PREP. The old code skipped the order because the job row
    // didn't change on this click. It must advance anyway.
    const d = productionCompletion(
      [READY, READY, READY, READY, READY, READY, READY],
      ProductionJobStatus.READY,
      OrderStatus.IN_PREP,
    );
    expect(d.advanceJob).toBe(false); // already there — nothing to write
    expect(d.advanceOrder).toBe(true); // …but the order still moves
  });

  it("also heals from READY_FOR_PRODUCTION, the other stuck status", () => {
    const d = productionCompletion(
      [READY, READY],
      ProductionJobStatus.READY,
      OrderStatus.READY_FOR_PRODUCTION,
    );
    expect(d.advanceOrder).toBe(true);
  });

  it("is a no-op once both have caught up (double-tap / retry)", () => {
    const d = productionCompletion(
      [READY, READY],
      ProductionJobStatus.READY,
      OrderStatus.READY,
    );
    expect(d.allItemsReady).toBe(true);
    expect(d.advanceJob).toBe(false);
    expect(d.advanceOrder).toBe(false);
  });

  it("advances the JOB when the order ran ahead instead", () => {
    // Mirror image: markOrderCooked moved the order but the job lagged.
    const d = productionCompletion(
      [READY, READY],
      ProductionJobStatus.COOKING,
      OrderStatus.READY,
    );
    expect(d.advanceJob).toBe(true);
    expect(d.advanceOrder).toBe(false);
  });
});

describe("advance guards never rewind or resurrect", () => {
  it("never advances a cancelled job or order", () => {
    const d = productionCompletion(
      [READY, READY],
      ProductionJobStatus.CANCELLED,
      OrderStatus.CANCELLED,
    );
    expect(d.allItemsReady).toBe(true);
    expect(d.advanceJob).toBe(false);
    expect(d.advanceOrder).toBe(false);
  });

  it("never advances an order that already moved past READY", () => {
    for (const s of [
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.INVOICED,
      OrderStatus.PAID,
      OrderStatus.COMPLETED,
    ]) {
      expect(
        productionCompletion([READY], ProductionJobStatus.READY, s).advanceOrder,
      ).toBe(false);
    }
  });

  it("keeps the DB guards and the decision in step", () => {
    // The updateMany WHERE clauses use these same arrays, so a status the
    // decision accepts is exactly one the guarded write accepts.
    expect(JOB_ADVANCE_FROM).not.toContain(ProductionJobStatus.READY);
    expect(JOB_ADVANCE_FROM).not.toContain(ProductionJobStatus.CANCELLED);
    expect(ORDER_ADVANCE_FROM).not.toContain(OrderStatus.READY);
    expect(ORDER_ADVANCE_FROM).not.toContain(OrderStatus.CANCELLED);
    for (const s of JOB_ADVANCE_FROM) {
      expect(productionCompletion([READY], s, OrderStatus.IN_PREP).advanceJob).toBe(true);
    }
    for (const s of ORDER_ADVANCE_FROM) {
      expect(
        productionCompletion([READY], ProductionJobStatus.READY, s).advanceOrder,
      ).toBe(true);
    }
  });
});
