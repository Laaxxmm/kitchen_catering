import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { CustomerInvoiceStatus, MealType, OrderChannel, OrderStatus } from "@prisma/client";
import { db } from "@/server/db";
import { createOrder } from "@/server/actions/orders";
import {
  createConsolidatedInHouseInvoice,
  createCustomerInvoiceFromOrder,
  issueCustomerInvoice,
  listCustomerInvoicesAwaitingApproval,
} from "@/server/actions/customer-invoices";
import {
  asDelivery,
  asManager,
  chefAccepts,
  driveOrderToDelivered,
  ensureSeeded,
  flushDeferred,
  mustOk,
  placeCateringOrder,
  seeded,
} from "../harness";

/**
 * The client's rule (29 Sep, restated 5 Oct): a room service bill needs no
 * manager or admin approval. So it never sits as a draft waiting on anyone:
 * whoever generates it — the F&B desk's folio, or accounts billing one
 * room-service order — gets an issued bill, and nothing about it reaches the
 * managers' approvals board. A catering invoice keeps the sign-off, and the
 * F&B desk cannot issue one.
 */

beforeAll(async () => {
  await ensureSeeded();
});

/** A served room-service order, ready to bill. The kitchen leg is not what
 *  this file is about, so the order is put at DELIVERED directly. */
async function servedRoomServiceOrder(): Promise<string> {
  asManager();
  const { dishIds } = seeded();
  const created = mustOk(
    await createOrder({
      channel: OrderChannel.ROOM_SERVICE,
      roomNumber: `R-${Date.now() % 10000}`,
      headcount: 2,
      mealType: MealType.DINNER,
      items: [{ dishId: dishIds[0], portions: "2", unitPrice: "260.00", gstRatePct: "5" }],
    }),
    "room service order",
  );
  await db.order.update({ where: { id: created.id }, data: { status: OrderStatus.DELIVERED } });
  return created.id;
}

async function approvalPings(invoiceId: string): Promise<number> {
  return db.notification.count({
    where: { link: `/invoices/${invoiceId}`, title: { contains: "needs your approval" } },
  });
}

describe("in-house bills need no approval", () => {
  it("the F&B desk's folio is issued the moment it is generated; managers are not asked", async () => {
    const orderId = await servedRoomServiceOrder();

    asDelivery();
    const folio = mustOk(await createConsolidatedInHouseInvoice([orderId]), "folio");
    await flushDeferred();

    const inv = await db.customerInvoice.findUniqueOrThrow({ where: { id: folio.id } });
    expect(inv.status).toBe(CustomerInvoiceStatus.ISSUED);
    expect(inv.issuedAt).not.toBeNull();
    expect(inv.approvedAt).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(OrderStatus.INVOICED);
    expect(await approvalPings(folio.id)).toBe(0);
  });

  it("billing one room-service order from the order is issued straight away too", async () => {
    const orderId = await servedRoomServiceOrder();

    asManager();
    const bill = mustOk(await createCustomerInvoiceFromOrder(orderId), "room service bill");
    await flushDeferred();

    const inv = await db.customerInvoice.findUniqueOrThrow({ where: { id: bill.id } });
    expect(inv.status).toBe(CustomerInvoiceStatus.ISSUED);
    expect(inv.approvedAt).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(OrderStatus.INVOICED);
    expect(await approvalPings(bill.id)).toBe(0);
  });

  it("a room-service draft left over from before is off the approvals board and issues unsigned", async () => {
    const orderId = await servedRoomServiceOrder();
    asDelivery();
    const folio = mustOk(await createConsolidatedInHouseInvoice([orderId]), "folio");
    // What production holds from 29 Sep – 5 Oct: in-house bills born drafts.
    await db.customerInvoice.update({
      where: { id: folio.id },
      data: { status: CustomerInvoiceStatus.DRAFT, issuedAt: null },
    });

    asManager();
    const board = await listCustomerInvoicesAwaitingApproval();
    expect(board.map((i) => i.id)).not.toContain(folio.id);

    asDelivery();
    mustOk(await issueCustomerInvoice(folio.id), "issue leftover draft");
    expect((await db.customerInvoice.findUniqueOrThrow({ where: { id: folio.id } })).status).toBe(
      CustomerInvoiceStatus.ISSUED,
    );
  });

  it("a catering invoice still waits for the sign-off, and the F&B desk cannot issue it", async () => {
    const order = await placeCateringOrder({ headcount: 20 });
    await chefAccepts(order.id);
    await driveOrderToDelivered(order.id);
    asManager();
    const invoice = mustOk(await createCustomerInvoiceFromOrder(order.id), "catering invoice");
    expect((await db.customerInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
      CustomerInvoiceStatus.DRAFT,
    );
    expect((await listCustomerInvoicesAwaitingApproval()).map((i) => i.id)).toContain(invoice.id);

    asDelivery();
    const byDesk = await issueCustomerInvoice(invoice.id);
    expect(byDesk.ok).toBe(false);
    if (!byDesk.ok) expect(byDesk.error).toMatch(/Catering invoices are issued by accounts/);

    asManager();
    const unsigned = await issueCustomerInvoice(invoice.id);
    expect(unsigned.ok).toBe(false);
    if (!unsigned.ok) expect(unsigned.error).toMatch(/hasn't been approved/);
    expect((await db.customerInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
      CustomerInvoiceStatus.DRAFT,
    );
  });
});
