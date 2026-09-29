import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { CustomerInvoiceStatus, MealType, OrderChannel, OrderStatus } from "@prisma/client";
import { db } from "@/server/db";
import { createOrder } from "@/server/actions/orders";
import {
  createConsolidatedInHouseInvoice,
  createCustomerInvoiceFromOrder,
  issueCustomerInvoice,
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
 * The client's rule, 29 Sep: a room service bill goes to the guest without a
 * manager or admin signing it off, and the F&B desk that raised it issues
 * it. A catering invoice keeps the sign-off, and the F&B desk cannot issue
 * one — the same action, told apart by what the bill is for.
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

describe("in-house bills need no sign-off", () => {
  it("the F&B desk raises the folio and issues it straight away; managers are not asked", async () => {
    const orderId = await servedRoomServiceOrder();

    asDelivery();
    const folio = mustOk(await createConsolidatedInHouseInvoice([orderId]), "folio");
    await flushDeferred();
    const asked = await db.notification.count({
      where: { link: `/invoices/${folio.id}`, title: { contains: "needs your approval" } },
    });
    expect(asked).toBe(0);

    const before = await db.customerInvoice.findUniqueOrThrow({ where: { id: folio.id } });
    expect(before.status).toBe(CustomerInvoiceStatus.DRAFT);
    expect(before.approvedAt).toBeNull();

    mustOk(await issueCustomerInvoice(folio.id), "issue folio");
    const after = await db.customerInvoice.findUniqueOrThrow({ where: { id: folio.id } });
    expect(after.status).toBe(CustomerInvoiceStatus.ISSUED);
    expect(after.issuedAt).not.toBeNull();
    expect(after.approvedAt).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(OrderStatus.INVOICED);
  });

  it("a catering invoice still needs the sign-off, and the F&B desk cannot issue it", async () => {
    const order = await placeCateringOrder({ headcount: 20 });
    await chefAccepts(order.id);
    await driveOrderToDelivered(order.id);
    asManager();
    const invoice = mustOk(await createCustomerInvoiceFromOrder(order.id), "catering invoice");

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
