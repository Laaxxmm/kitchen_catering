import { beforeAll, describe, expect, it } from "vitest";
import {
  CustomerInvoiceKind,
  CustomerInvoiceStatus,
  OrderStatus,
  PaymentMethod,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  approveCustomerInvoiceForRelease,
  createCustomerInvoiceFromOrder,
  emailTaxInvoice,
  getCustomerInvoiceByToken,
  issueCustomerInvoice,
  markCustomerInvoicePaid,
  updateDraftInvoice,
} from "@/server/actions/customer-invoices";
import { recordCustomerInvoicePayment } from "@/server/actions/payments";
import {
  asAccounts,
  asAdmin,
  asChef,
  asDelivery,
  asManager,
  asStore,
  chefAccepts,
  driveOrderToDelivered,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  flushDeferred,
  mustOk,
  placeCateringOrder,
  read,
} from "./harness";

/**
 * Scenario 2 — the bill. An order billed for 100 that fed 120 must not reach
 * the customer before a manager has looked at the number, so the invoice is
 * born a DRAFT and every customer-facing door is shut until it is issued.
 */

let orderId: string;
let invoiceId: string;
let shareToken: string;

/** 250,000 package + 5% catering GST. */
const BOOKED_TOTAL = "262500";
/** Re-priced for the 120 who actually turned up: 300,000 + 5%. */
const FINAL_TOTAL = "315000";
const COLLECTED_AT_DOOR = "50000";

beforeAll(async () => {
  await ensureSeeded();
  const order = await placeCateringOrder({ headcount: 100, packageTotal: "250000" });
  orderId = order.id;
  await chefAccepts(orderId);
  await driveOrderToDelivered(orderId, { collectAtDoor: COLLECTED_AT_DOOR });
});

describe("the delivery closes, the bill does not", () => {
  it("leaves the order DELIVERED with the door money on the delivery", async () => {
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.DELIVERED);
    const delivery = await db.delivery.findFirstOrThrow({ where: { orderId } });
    expect(delivery.paymentCollected).toBe(true);
    expectDecimal(delivery.paymentAmount, COLLECTED_AT_DOOR, "collected at door");
  });

  it("does not invoice the customer on the driver's tap", async () => {
    // Auto-invoicing on delivery was deliberately removed — the bill is a
    // manager's decision, made after the event.
    expect(await read.taxInvoiceForOrder(orderId)).toBeNull();
  });
});

describe("the manager generates the invoice", () => {
  it("is not the store's or the driver's to raise", async () => {
    for (const become of [asStore, asDelivery, asChef]) {
      become();
      await expectRefused(() => createCustomerInvoiceFromOrder(orderId));
    }
  });

  it("creates it as a DRAFT that credits the door money", async () => {
    asManager();
    const created = mustOk(
      await createCustomerInvoiceFromOrder(orderId),
      "create invoice from order",
    );
    invoiceId = created.id;

    const invoice = await read.invoice(invoiceId);
    shareToken = invoice.shareToken;
    expect(invoice.status).toBe(CustomerInvoiceStatus.DRAFT);
    expect(invoice.approvedAt).toBeNull();
    expect(invoice.issuedAt).toBeNull();
    expect(invoice.finalHeadcount).toBe(100);
    expectDecimal(invoice.grandTotal, BOOKED_TOTAL, "grand total as booked");
    expectDecimal(invoice.amountPaid, COLLECTED_AT_DOOR, "door money credited");
    // The order leaves the "generate invoice" screen but isn't settled.
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.INVOICED);
  });

  it("refuses a second tax invoice for the same order", async () => {
    asManager();
    const message = await expectRefused(() => createCustomerInvoiceFromOrder(orderId));
    // Creating the first invoice moved the order off DELIVERED, so the
    // status guard catches the double-click before the one-invoice-per-order
    // rule ever has to.
    expect(message).toContain("invoiced");
    expect(await db.customerInvoice.count({ where: { orderId, kind: "ORDER" } })).toBe(1);
  });
});

describe("a draft must not reach the customer", () => {
  it("is invisible on its own share link", async () => {
    expect(await getCustomerInvoiceByToken(shareToken)).toBeNull();
  });

  it("cannot be emailed, even by a manager clicking send", async () => {
    asManager();
    const message = await expectRefused(() => emailTaxInvoice(invoiceId, { force: true }));
    expect(message).toContain("approve");
    const invoice = await read.invoice(invoiceId);
    expect(invoice.emailedAt).toBeNull();
  });

  it("cannot be issued before it is approved", async () => {
    asManager();
    const message = await expectRefused(() => issueCustomerInvoice(invoiceId));
    expect(message).toContain("hasn't been approved for release");
    expect((await read.invoice(invoiceId)).status).toBe(CustomerInvoiceStatus.DRAFT);
  });
});

describe("100 booked, 120 ate", () => {
  it("lets the desk that prepares the bill correct it", async () => {
    // ACCOUNTS may edit the draft — preparing the numbers is their job.
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
      "edit draft invoice",
    );

    const invoice = await read.invoice(invoiceId);
    expect(invoice.finalHeadcount).toBe(120);
    expectDecimal(invoice.grandTotal, FINAL_TOTAL, "grand total re-priced");
    expectDecimal(invoice.amountPaid, COLLECTED_AT_DOOR, "door money still credited");
  });
});

describe("approval is the manager's signature", () => {
  it("accounts cannot approve the invoice they prepared", async () => {
    asAccounts();
    const message = await expectRefused(() => approveCustomerInvoiceForRelease(invoiceId));
    expect(message).toContain("Requires one of");
    expect((await read.invoice(invoiceId)).approvedAt).toBeNull();
  });

  it("neither can the store, the chef or the driver", async () => {
    for (const become of [asStore, asChef, asDelivery]) {
      become();
      await expectRefused(() => approveCustomerInvoiceForRelease(invoiceId));
    }
  });

  it("the manager signs it off against the numbers they can see", async () => {
    asManager();
    mustOk(
      await approveCustomerInvoiceForRelease(invoiceId, "120 pax confirmed with the client"),
      "approve invoice",
    );
    const invoice = await read.invoice(invoiceId);
    expect(invoice.approvedAt).not.toBeNull();
    expect(invoice.approvalNote).toContain("120 pax");
    // Still not the customer's — approval and release are two steps.
    expect(invoice.status).toBe(CustomerInvoiceStatus.DRAFT);
    expect(await getCustomerInvoiceByToken(shareToken)).toBeNull();
  });

  it("refuses a second signature", async () => {
    asAdmin();
    const message = await expectRefused(() => approveCustomerInvoiceForRelease(invoiceId));
    expect(message).toContain("already approved");
  });
});

describe("only now is it issued", () => {
  it("releases the invoice, part-settled by the door money", async () => {
    asManager();
    mustOk(await issueCustomerInvoice(invoiceId), "issue invoice");

    const invoice = await read.invoice(invoiceId);
    // 50,000 of 315,000 collected at the door — issued and partly paid.
    expect(invoice.status).toBe(CustomerInvoiceStatus.PARTIAL);
    expect(invoice.issuedAt).not.toBeNull();
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.INVOICED);
  });

  it("opens the customer's share link and sends the copy", async () => {
    const shared = await getCustomerInvoiceByToken(shareToken);
    expect(shared?.id).toBe(invoiceId);
    expectDecimal(shared?.grandTotal, FINAL_TOTAL, "shared grand total");
    // The email goes out from the issue step and nowhere else.
    expect((await read.invoice(invoiceId)).emailedAt).not.toBeNull();
  });

  it("locks the numbers once issued", async () => {
    asManager();
    const message = await expectRefused(() =>
      updateDraftInvoice(invoiceId, {
        lines: [
          { description: "cheaper", quantity: "1", unit: "package", unitPrice: "1", gstRatePct: "5" },
        ],
      }),
    );
    expect(message).toContain("Only DRAFT invoices can be edited");
    expectDecimal((await read.invoice(invoiceId)).grandTotal, FINAL_TOTAL, "grand total unchanged");
  });
});

describe("the proforma is an estimate, not a bill", () => {
  let proformaId: string;
  let liveOrderId: string;

  beforeAll(async () => {
    // A second order, parked mid-flight: the chef has accepted it, so the
    // auto-proforma exists, but nothing has been cooked or delivered.
    const order = await placeCateringOrder({ headcount: 80, packageTotal: "200000" });
    liveOrderId = order.id;
    await chefAccepts(liveOrderId);
    await flushDeferred();
    const proforma = await db.customerInvoice.findFirstOrThrow({
      where: { orderId: liveOrderId, kind: CustomerInvoiceKind.PROFORMA },
    });
    proformaId = proforma.id;
  });

  it("is born ISSUED and carries the full order value", async () => {
    // Which is exactly why it looked like a settleable bill.
    const proforma = await read.invoice(proformaId);
    expect(proforma.status).toBe(CustomerInvoiceStatus.ISSUED);
    expectDecimal(proforma.grandTotal, "210000", "proforma value");
  });

  it("refuses a recorded payment against it", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      recordCustomerInvoicePayment({
        invoiceId: proformaId,
        amount: "210000",
        method: PaymentMethod.UPI,
      }),
    );
    expect(message).toContain("is a proforma");
  });

  it("refuses the one-click mark-paid too", async () => {
    asManager();
    const message = await expectRefused(() =>
      markCustomerInvoicePaid({ invoiceId: proformaId, method: PaymentMethod.UPI }),
    );
    expect(message).toContain("is a proforma");
  });

  it("leaves the order still to be cooked, and no cash outside receivables", async () => {
    // The whole point: settling the proforma used to flip the order to
    // COMPLETED — an event closed and paid before anyone had cooked it, with
    // the money invisible to every AR/GST/P&L query (all EXCLUDE_PROFORMA).
    expect(await read.orderStatus(liveOrderId)).toBe(OrderStatus.CHEF_REQUISITION_PENDING);
    const proforma = await read.invoice(proformaId);
    expect(proforma.status).toBe(CustomerInvoiceStatus.ISSUED);
    expectDecimal(proforma.amountPaid, "0", "proforma amount paid");
    expect(await db.customerInvoicePayment.count({ where: { invoiceId: proformaId } })).toBe(0);
  });
});
