import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { CustomerInvoiceStatus, OrderStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
import {
  approveCustomerInvoiceForRelease,
  cancelCustomerInvoice,
  createCustomerInvoiceFromOrder,
  issueCustomerInvoice,
} from "@/server/actions/customer-invoices";
import { cancelOrder, getOrder } from "@/server/actions/orders";
import {
  asAccounts,
  asAdmin,
  asChef,
  asDelivery,
  asManager,
  asStore,
  chefAccepts,
  desk,
  driveOrderToDelivered,
  ensureSeeded,
  expectRefused,
  flushDeferred,
  mustOk,
  placeCateringOrder,
  read,
} from "../harness";

/**
 * Two go-live permission findings about the order record.
 *
 * 1. Cancelling an order the customer has already been billed for. The
 *    invoice is the customer-facing document, so it — not the order — has to
 *    be dealt with first; cancelOrder used to walk past a live one.
 * 2. Reading one order by id. `listOrders` scopes F&B/delivery to in-house
 *    channels; the detail read had no gate at all beyond "signed in".
 */

/** Order → delivered → invoiced → issued, optionally part-paid at the door. */
async function billedOrder(collectAtDoor?: string): Promise<{
  orderId: string;
  invoiceId: string;
  invoiceNo: string;
}> {
  const order = await placeCateringOrder({ headcount: 100, packageTotal: "250000" });
  await chefAccepts(order.id);
  await driveOrderToDelivered(order.id, collectAtDoor ? { collectAtDoor } : {});

  asManager();
  const invoice = mustOk(await createCustomerInvoiceFromOrder(order.id), "invoice the order");
  mustOk(await approveCustomerInvoiceForRelease(invoice.id, "signed off"), "approve invoice");
  mustOk(await issueCustomerInvoice(invoice.id), "issue invoice");
  await flushDeferred();

  return { orderId: order.id, invoiceId: invoice.id, invoiceNo: invoice.invoiceNo };
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("cancelling an order the customer has already been billed for", () => {
  it("refuses while money has been collected against the invoice", async () => {
    const { orderId, invoiceId, invoiceNo } = await billedOrder("50000");
    expect((await read.invoice(invoiceId)).status).toBe(CustomerInvoiceStatus.PARTIAL);

    asManager();
    const message = await expectRefused(() => cancelOrder(orderId, "client called it off"));
    expect(message).toContain(invoiceNo);
    expect(message).toMatch(/reverse/i);
    // The order is still standing, with its money and its bill agreeing.
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.INVOICED);
  });

  it("refuses while an unpaid invoice is still live, and says which one", async () => {
    const { orderId, invoiceNo } = await billedOrder();

    asManager();
    const message = await expectRefused(() => cancelOrder(orderId, "double booking"));
    expect(message).toContain(invoiceNo);
    expect(message).toMatch(/cancel/i);
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.INVOICED);
  });

  it("cancels once that invoice has been credited", async () => {
    const { orderId, invoiceId } = await billedOrder();

    asManager();
    mustOk(await cancelCustomerInvoice(invoiceId, "event cancelled"), "cancel invoice");
    // Cancelling the invoice hands the order back at DELIVERED, which is
    // what makes the two-step advice in the refusal actually work.
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.DELIVERED);

    mustOk(await cancelOrder(orderId, "client called it off"), "cancel order");
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.CANCELLED);
  });

  it("still cancels an accepted order carrying only its auto-proforma", async () => {
    // Every chef-accepted order gets a PROFORMA, and it lands as ISSUED. It
    // is an estimate, not a receivable — if it blocked the cancel, no
    // accepted event could ever be called off.
    const order = await placeCateringOrder({ headcount: 60, packageTotal: "120000" });
    await chefAccepts(order.id);
    await flushDeferred();
    expect(
      await db.customerInvoice.count({
        where: { orderId: order.id, kind: "PROFORMA", status: CustomerInvoiceStatus.ISSUED },
      }),
    ).toBe(1);

    asManager();
    mustOk(await cancelOrder(order.id, "client called it off"), "cancel order");
    expect(await read.orderStatus(order.id)).toBe(OrderStatus.CANCELLED);
  });
});

describe("reading one order by id", () => {
  let orderId: string;

  beforeAll(async () => {
    const order = await placeCateringOrder({ headcount: 40, packageTotal: "80000" });
    orderId = order.id;
  });

  /**
   * Act as a role that has no seeded desk of its own. `requireRole` reads the
   * role off the session object and nothing else, so re-badging a registered
   * user IS the role change — put it back afterwards.
   */
  async function asRole<T>(role: Role, fn: () => Promise<T>): Promise<T> {
    const user = desk("store");
    const real = user.role;
    user.role = role;
    asStore();
    try {
      return await fn();
    } finally {
      user.role = real;
    }
  }

  it("is refused for a role the orders module never admits", async () => {
    for (const role of [Role.HOUSEKEEPING_MANAGER, Role.MAINTENANCE_MANAGER]) {
      const message = await asRole(role, () => expectRefused(() => getOrder(orderId)));
      expect(message).toMatch(/^Requires one of/);
    }
  });

  it("still opens for every desk the orders pages admit", async () => {
    // The middleware lets all of these onto /orders, and several flows hand
    // them an id directly — the delivery board's event-prep and upcoming
    // lists are both banquet-only, so scoping this read by channel the way
    // listOrders does would blank the driver's own screen.
    for (const become of [asAdmin, asManager, asChef, asStore, asDelivery, asAccounts]) {
      become();
      expect((await getOrder(orderId))?.id).toBe(orderId);
    }
  });
});
