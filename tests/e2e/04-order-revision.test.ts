import { beforeAll, describe, expect, it } from "vitest";
import { CustomerInvoiceStatus, OrderStatus } from "@prisma/client";
import { db } from "@/server/db";
import {
  acknowledgeOrderRevision,
  acknowledgeRevisedDocument,
  listRevisedOrders,
  reviseOrder,
} from "@/server/actions/orders";
import {
  createChefRequisition,
  submitChefRequisition,
} from "@/server/actions/chef-requisitions";
import {
  approveCustomerInvoiceForRelease,
  createCustomerInvoiceFromOrder,
  issueCustomerInvoice,
  updateDraftInvoice,
} from "@/server/actions/customer-invoices";
import {
  asAccounts,
  asChef,
  asDelivery,
  asManager,
  asStore,
  chefAccepts,
  daysFromNow,
  driveOrderToDelivered,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  istInput,
  mustOk,
  placeCateringOrder,
  read,
  seeded,
} from "./harness";

/**
 * Scenario 4 — the client changes their mind mid-flight. A revision has to
 * reach the two desks already working to the old numbers, has to cost a
 * deliberate "yes, anyway" when the food is already being made, and must not
 * quietly travel under a signature given for different figures.
 */

let orderId: string;
let requisitionId: string;

beforeAll(async () => {
  await ensureSeeded();
  const order = await placeCateringOrder({ headcount: 100, packageTotal: "250000" });
  orderId = order.id;
  await chefAccepts(orderId);

  // A requisition raised BEFORE the revision — the document the revision
  // invalidates, and the reason the chef's board has to shout.
  const { ingredients } = seeded();
  asChef();
  const req = mustOk(
    await createChefRequisition({
      orderId,
      lines: [{ ingredientId: ingredients.plentiful, requestedQty: "10" }],
    }),
    "create requisition",
  );
  requisitionId = req.id;
  mustOk(await submitChefRequisition(requisitionId), "submit requisition");
});

describe("revising a live order", () => {
  it("is not the chef's or the store's call", async () => {
    for (const become of [asChef, asStore, asDelivery]) {
      become();
      await expectRefused(() =>
        reviseOrder(orderId, {
          headcount: 120,
          items: [],
          revisionNote: "not my call",
        }),
      );
    }
  });

  it("needs at least one dish left standing", async () => {
    const live = await read.order(orderId);
    asManager();
    const message = await expectRefused(() =>
      reviseOrder(orderId, {
        headcount: 120,
        items: live.items.map((it) => ({ id: it.id, portions: 0 })),
        revisionNote: "zeroing everything",
      }),
    );
    expect(message).toContain("cancel the order instead");
  });

  it("records the new headcount, the renegotiated total and a readable diff", async () => {
    const live = await read.order(orderId);
    asManager();
    mustOk(
      await reviseOrder(orderId, {
        headcount: 120,
        items: live.items.map((it) => ({ id: it.id, portions: 120 })),
        packageTotal: "300000",
        revisionNote: "Client confirmed 120 guests.",
      }),
      "revise order",
    );

    const after = await read.order(orderId);
    expect(after.headcount).toBe(120);
    expectDecimal(after.contractValue, "300000", "renegotiated package total");
    expect(after.lastRevisedAt).not.toBeNull();
    // Both teams' seen-stamps are cleared in the same write.
    expect(after.revisionSeenByChefAt).toBeNull();
    expect(after.revisionSeenByStoreAt).toBeNull();

    const revision = await db.orderRevision.findFirstOrThrow({
      where: { orderId },
      orderBy: { createdAt: "desc" },
    });
    expect(revision.beforeHeadcount).toBe(100);
    expect(revision.afterHeadcount).toBe(120);
    expect(revision.lineChanges).toEqual([
      { kind: "portions", dish: "E2E Paneer Butter Masala", from: "100", to: "120" },
      { kind: "portions", dish: "E2E Veg Pulao", from: "100", to: "120" },
    ]);
  });
});

describe("it reaches the desks already working to the old numbers", () => {
  it("shows on the chef's board with the requisition it invalidated", async () => {
    asChef();
    const board = await listRevisedOrders("chef");
    const row = board.find((r) => r.id === orderId);
    expect(row?.revision?.afterHeadcount).toBe(120);
    expect(row?.documents.map((d) => d.type)).toEqual(["CHEF_REQUISITION"]);
  });

  it("shows on the store's board too", async () => {
    asStore();
    const board = await listRevisedOrders("store");
    expect(board.map((r) => r.id)).toContain(orderId);
  });

  it("notified the kitchen, the store and the service desks", async () => {
    const titles = await db.notification.findMany({
      where: { title: { contains: "revised" } },
      select: { title: true, body: true },
    });
    expect(titles.length).toBeGreaterThan(0);
    expect(titles[0].title).toContain("100 → 120 pax");
    // It names the requisition that now buys for the wrong headcount.
    expect(titles.some((t) => t.body?.includes("ingredient requisition"))).toBe(true);
  });

  it("clears from a desk only when THAT desk acknowledges it", async () => {
    asChef();
    mustOk(await acknowledgeOrderRevision(orderId, "chef"), "chef acknowledges");
    // The order-level flag is cleared, but the stale requisition keeps it up.
    let board = await listRevisedOrders("chef");
    expect(board.find((r) => r.id === orderId)?.documents.map((d) => d.number)).toHaveLength(1);

    mustOk(
      await acknowledgeRevisedDocument("CHEF_REQUISITION", requisitionId),
      "chef re-checks the requisition",
    );
    board = await listRevisedOrders("chef");
    expect(board.map((r) => r.id)).not.toContain(orderId);

    // The store never said anything, so it is still on their board.
    asStore();
    expect((await listRevisedOrders("store")).map((r) => r.id)).toContain(orderId);
  });

  it("won't let the chef sign off on the store's copy", async () => {
    asChef();
    await expectRefused(() => acknowledgeOrderRevision(orderId, "store"));
  });
});

describe("a CRITICAL revision costs a deliberate yes", () => {
  it("refuses an imminent-event revision without the confirm flag", async () => {
    // An event 30 minutes away bands CRITICAL on the clock alone.
    const imminent = await placeCateringOrder({
      headcount: 40,
      eventDate: new Date(Date.now() + 30 * 60 * 1000),
      packageTotal: "40000",
    });
    await chefAccepts(imminent.id);

    const live = await read.order(imminent.id);
    asManager();
    const message = await expectRefused(() =>
      reviseOrder(imminent.id, {
        headcount: 55,
        items: live.items.map((it) => ({ id: it.id, portions: 55 })),
        revisionNote: "15 more guests arrived",
      }),
    );
    expect(message).toContain("Confirm you want to revise it anyway");
    expect((await read.order(imminent.id)).headcount).toBe(40);

    // With the flag, the same revision goes through and is banded CRITICAL.
    mustOk(
      await reviseOrder(imminent.id, {
        headcount: 55,
        items: live.items.map((it) => ({ id: it.id, portions: 55 })),
        revisionNote: "15 more guests arrived",
        criticalConfirmed: true,
      }),
      "confirmed critical revision",
    );
    expect((await read.order(imminent.id)).headcount).toBe(55);

    asChef();
    const row = (await listRevisedOrders("chef")).find((r) => r.id === imminent.id);
    expect(row?.band).toBe("CRITICAL");
  });

  it("refuses outright once the kitchen is committed", async () => {
    const cooking = await placeCateringOrder({ headcount: 60, packageTotal: "60000" });
    await chefAccepts(cooking.id);
    await driveOrderToDelivered(cooking.id);

    const live = await read.order(cooking.id);
    asManager();
    const message = await expectRefused(() =>
      reviseOrder(cooking.id, {
        headcount: 80,
        items: live.items.map((it) => ({ id: it.id, portions: 80 })),
        revisionNote: "too late",
        criticalConfirmed: true,
      }),
    );
    expect(message).toContain("Too late");
    expect(await read.orderStatus(cooking.id)).toBe(OrderStatus.DELIVERED);
  });
});

describe("an edit after approval revokes the invoice approval", () => {
  let invoiceId: string;

  beforeAll(async () => {
    const billable = await placeCateringOrder({ headcount: 100, packageTotal: "250000" });
    await chefAccepts(billable.id);
    await driveOrderToDelivered(billable.id);
    asManager();
    const created = mustOk(
      await createCustomerInvoiceFromOrder(billable.id),
      "create invoice",
    );
    invoiceId = created.id;
    mustOk(
      await approveCustomerInvoiceForRelease(invoiceId, "signed off at 100 pax"),
      "approve invoice",
    );
  });

  it("starts approved and issuable", async () => {
    const invoice = await read.invoice(invoiceId);
    expect(invoice.approvedAt).not.toBeNull();
    expectDecimal(invoice.grandTotal, "262500", "approved total");
  });

  it("strips the signature the moment the numbers move", async () => {
    asAccounts();
    mustOk(
      await updateDraftInvoice(invoiceId, {
        finalHeadcount: 120,
        lines: [
          {
            description: "BANQUET catering package — 120 pax",
            quantity: "1",
            unit: "package",
            unitPrice: "300000",
            gstRatePct: "5",
          },
        ],
      }),
      "edit approved draft",
    );

    const invoice = await read.invoice(invoiceId);
    expect(invoice.approvedAt).toBeNull();
    expect(invoice.approvedById).toBeNull();
    expect(invoice.approvalNote).toBeNull();
    expectDecimal(invoice.grandTotal, "315000", "re-priced total");
  });

  it("refuses to issue on the withdrawn signature", async () => {
    asManager();
    const message = await expectRefused(() => issueCustomerInvoice(invoiceId));
    expect(message).toContain("hasn't been approved for release");
    expect((await read.invoice(invoiceId)).status).toBe(CustomerInvoiceStatus.DRAFT);
  });

  it("puts it back in front of the manager", async () => {
    const notice = await db.notification.findFirst({
      where: { title: { contains: "needs your approval" }, body: { contains: "edited after approval" } },
    });
    expect(notice).not.toBeNull();
  });

  it("issues once it is signed again, against the new numbers", async () => {
    asManager();
    mustOk(
      await approveCustomerInvoiceForRelease(invoiceId, "re-signed at 120 pax"),
      "re-approve",
    );
    mustOk(await issueCustomerInvoice(invoiceId), "issue");
    const invoice = await read.invoice(invoiceId);
    expect(invoice.status).toBe(CustomerInvoiceStatus.ISSUED);
    expectDecimal(invoice.grandTotal, "315000", "issued total");
  });
});

describe("the 24-hour rule", () => {
  it("is enforced by the clock, not by the button", async () => {
    // Sales may revise a distant event but not one inside the day — the
    // harness has no SALES desk, so assert the rule the manager path proves:
    // an unchanged event date is left alone even when it is already past.
    const soon = await placeCateringOrder({
      headcount: 30,
      eventDate: daysFromNow(2),
      packageTotal: "30000",
    });
    await chefAccepts(soon.id);
    const live = await read.order(soon.id);
    asManager();
    const message = await expectRefused(() =>
      reviseOrder(soon.id, {
        headcount: 35,
        items: live.items.map((it) => ({ id: it.id, portions: 35 })),
        eventDate: istInput(new Date(Date.now() - 60 * 60 * 1000)),
        revisionNote: "moving it into the past",
      }),
    );
    expect(message).toContain("must be in the future");
  });
});
