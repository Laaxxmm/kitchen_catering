import { describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import {
  FORCE_DELIVERABLE_ORDER_STATUSES,
  INACTIVE_ORDER_STATUSES,
  STATUS_LABEL,
} from "@/lib/order-status";

/**
 * The admin/manager "mark as delivered" override skips the normal workflow
 * controls, so the set of statuses it accepts is the only thing standing
 * between it and a billing mistake. These guard that set.
 */
describe("FORCE_DELIVERABLE_ORDER_STATUSES", () => {
  it("never includes an order that is already delivered or billed", () => {
    // Forcing one of these would re-open settled money: DELIVERED is already
    // invoiceable, and INVOICED/PAID/COMPLETED have real financial records
    // hanging off them.
    for (const s of [
      OrderStatus.DELIVERED,
      OrderStatus.INVOICED,
      OrderStatus.PAID,
      OrderStatus.COMPLETED,
    ]) {
      expect(FORCE_DELIVERABLE_ORDER_STATUSES).not.toContain(s);
    }
  });

  it("never resurrects a cancelled or rejected order", () => {
    for (const s of INACTIVE_ORDER_STATUSES) {
      expect(FORCE_DELIVERABLE_ORDER_STATUSES).not.toContain(s);
    }
  });

  it("never bills an order nobody approved", () => {
    // An order still sitting in an approval gate was never a confirmed
    // event — the way out of those is cancellation, not an invoice.
    for (const s of [
      OrderStatus.DRAFT,
      OrderStatus.PENDING_ADMIN_APPROVAL,
      OrderStatus.PENDING_CHEF_APPROVAL,
      OrderStatus.CHANGES_PROPOSED_BY_CHEF,
    ]) {
      expect(FORCE_DELIVERABLE_ORDER_STATUSES).not.toContain(s);
    }
  });

  it("covers the stages an order actually strands in", () => {
    // ISSUING is the one that stranded the July orders (store never
    // finished issuing); the rest are the same trap one step later.
    for (const s of [
      OrderStatus.CHEF_REQUISITION_PENDING,
      OrderStatus.ISSUING,
      OrderStatus.READY_FOR_PRODUCTION,
      OrderStatus.IN_PREP,
      OrderStatus.READY,
    ]) {
      expect(FORCE_DELIVERABLE_ORDER_STATUSES).toContain(s);
    }
  });

  it("has a human label for every status it offers", () => {
    for (const s of FORCE_DELIVERABLE_ORDER_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
    }
  });
});
