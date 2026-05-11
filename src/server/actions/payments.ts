"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import {
  CustomerInvoiceStatus,
  OrderStatus,
  PaymentMethod,
  Role,
  VendorBillStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  AuthorizationError,
  requireRole,
} from "@/server/rbac";
import {
  CustomerInvoicePaymentInput,
  PaymentReversalInput,
  VendorBillPaymentInput,
} from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];

function methodCanonical(m: string | PaymentMethod): PaymentMethod {
  return m as PaymentMethod;
}

/**
 * Record a payment against an ISSUED invoice. Recomputes amountPaid as the
 * sum of non-reversed payments and flips invoice.status:
 *   amountPaid == 0           -> ISSUED       (no change)
 *   0 < amountPaid < total    -> PARTIAL
 *   amountPaid >= total       -> PAID
 * If the invoice flips to PAID and is tied to an Order, the order also
 * flips to PAID.
 */
export async function recordCustomerInvoicePayment(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = CustomerInvoicePaymentInput.parse(raw);
  if (toDecimal(input.amount).lte(0)) throw new Error("Amount must be positive");

  const result = await db.$transaction(async (tx) => {
    const invoice = await tx.customerInvoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, status: true, grandTotal: true, orderId: true },
    });
    if (!invoice) throw new Error("Invoice not found");
    if (
      invoice.status !== CustomerInvoiceStatus.ISSUED &&
      invoice.status !== CustomerInvoiceStatus.PARTIAL
    ) {
      throw new AuthorizationError(`Cannot record payment on invoice in status ${invoice.status}`);
    }

    const payment = await tx.customerInvoicePayment.create({
      data: {
        invoiceId: invoice.id,
        amount: input.amount,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        method: methodCanonical(input.method),
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedById: session.user.id,
      },
    });

    // Recompute amountPaid
    const liveRows = await tx.customerInvoicePayment.findMany({
      where: { invoiceId: invoice.id, reversedAt: null },
      select: { amount: true },
    });
    const paid = liveRows.reduce((s, r) => s.plus(new Decimal(r.amount.toString())), new Decimal(0));
    const grand = new Decimal(invoice.grandTotal.toString());
    const fullyPaid = paid.gte(grand);
    const partial = paid.gt(0) && !fullyPaid;

    await tx.customerInvoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: paid.toDecimalPlaces(2).toString(),
        paidAt: fullyPaid ? new Date() : null,
        status: fullyPaid
          ? CustomerInvoiceStatus.PAID
          : partial
            ? CustomerInvoiceStatus.PARTIAL
            : CustomerInvoiceStatus.ISSUED,
      },
    });

    if (fullyPaid && invoice.orderId) {
      await tx.order.update({
        where: { id: invoice.orderId },
        data: { status: OrderStatus.PAID },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_PAYMENT_RECORDED",
        entity: "CustomerInvoicePayment",
        entityId: payment.id,
        payloadHash: sha256Json({ invoiceId: invoice.id, amount: input.amount, method: input.method }),
      },
    });

    return payment;
  });

  revalidatePath(`/invoices/${input.invoiceId}`);
  revalidatePath("/payments/receivables");
  return { id: result.id };
}

export async function reverseCustomerInvoicePayment(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = PaymentReversalInput.parse(raw);

  await db.$transaction(async (tx) => {
    const payment = await tx.customerInvoicePayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, invoiceId: true, reversedAt: true },
    });
    if (!payment) throw new Error("Payment not found");
    if (payment.reversedAt) throw new Error("Payment is already reversed");

    await tx.customerInvoicePayment.update({
      where: { id: payment.id },
      data: {
        reversedAt: new Date(),
        reversedReason: input.reason,
        reversedById: session.user.id,
      },
    });

    // Recompute parent invoice.amountPaid + status.
    const invoice = await tx.customerInvoice.findUnique({
      where: { id: payment.invoiceId },
      select: { id: true, grandTotal: true, orderId: true },
    });
    if (!invoice) throw new Error("Parent invoice missing");
    const liveRows = await tx.customerInvoicePayment.findMany({
      where: { invoiceId: invoice.id, reversedAt: null },
      select: { amount: true },
    });
    const paid = liveRows.reduce((s, r) => s.plus(new Decimal(r.amount.toString())), new Decimal(0));
    const grand = new Decimal(invoice.grandTotal.toString());
    const fullyPaid = paid.gte(grand);
    const partial = paid.gt(0) && !fullyPaid;

    await tx.customerInvoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: paid.toDecimalPlaces(2).toString(),
        paidAt: fullyPaid ? new Date() : null,
        status: fullyPaid
          ? CustomerInvoiceStatus.PAID
          : partial
            ? CustomerInvoiceStatus.PARTIAL
            : CustomerInvoiceStatus.ISSUED,
      },
    });

    // If the order had auto-flipped to PAID, demote it.
    if (invoice.orderId && !fullyPaid) {
      const orderNow = await tx.order.findUnique({
        where: { id: invoice.orderId },
        select: { status: true },
      });
      if (orderNow?.status === OrderStatus.PAID) {
        await tx.order.update({
          where: { id: invoice.orderId },
          data: { status: OrderStatus.INVOICED },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_PAYMENT_REVERSED",
        entity: "CustomerInvoicePayment",
        entityId: payment.id,
        payloadHash: sha256Json({ reason: input.reason }),
      },
    });
  });

  revalidatePath("/payments/receivables");
}

export async function listReceivablePayments(limit = 100) {
  await requireRole([...WRITE_ROLES, Role.SALES]);
  return db.customerInvoicePayment.findMany({
    orderBy: { paidAt: "desc" },
    take: limit,
    include: {
      invoice: { select: { invoiceNo: true, customerId: true, customer: { select: { name: true } } } },
      recordedBy: { select: { name: true } },
    },
  });
}

// =====================================================================
// VENDOR BILL PAYMENTS (AP) — Phase 2 wires this up
// =====================================================================

export async function recordVendorBillPayment(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = VendorBillPaymentInput.parse(raw);
  if (toDecimal(input.amount).lte(0)) throw new Error("Amount must be positive");

  const result = await db.$transaction(async (tx) => {
    const bill = await tx.vendorBill.findUnique({
      where: { id: input.billId },
      select: { id: true, status: true, grandTotal: true },
    });
    if (!bill) throw new Error("Bill not found");
    if (bill.status !== VendorBillStatus.APPROVED && bill.status !== VendorBillStatus.MATCHED) {
      throw new AuthorizationError(`Cannot pay a bill in status ${bill.status}`);
    }
    const payment = await tx.vendorBillPayment.create({
      data: {
        vendorBillId: bill.id,
        amount: input.amount,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        method: methodCanonical(input.method),
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedById: session.user.id,
      },
    });
    const liveRows = await tx.vendorBillPayment.findMany({
      where: { vendorBillId: bill.id, reversedAt: null },
      select: { amount: true },
    });
    const paid = liveRows.reduce((s, r) => s.plus(new Decimal(r.amount.toString())), new Decimal(0));
    const grand = new Decimal(bill.grandTotal.toString());
    const fullyPaid = paid.gte(grand);

    await tx.vendorBill.update({
      where: { id: bill.id },
      data: {
        amountPaid: paid.toDecimalPlaces(2).toString(),
        paidAt: fullyPaid ? new Date() : null,
        status: fullyPaid ? VendorBillStatus.PAID : VendorBillStatus.APPROVED,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_BILL_PAYMENT_RECORDED",
        entity: "VendorBillPayment",
        entityId: payment.id,
        payloadHash: sha256Json({ billId: bill.id, amount: input.amount }),
      },
    });
    return payment;
  });

  revalidatePath(`/procurement/vendor-bills/${input.billId}`);
  revalidatePath("/payments/payables");
  return { id: result.id };
}

export async function reverseVendorBillPayment(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = PaymentReversalInput.parse(raw);

  await db.$transaction(async (tx) => {
    const payment = await tx.vendorBillPayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, vendorBillId: true, reversedAt: true },
    });
    if (!payment) throw new Error("Payment not found");
    if (payment.reversedAt) throw new Error("Payment already reversed");
    await tx.vendorBillPayment.update({
      where: { id: payment.id },
      data: {
        reversedAt: new Date(),
        reversedReason: input.reason,
        reversedById: session.user.id,
      },
    });
    const bill = await tx.vendorBill.findUnique({
      where: { id: payment.vendorBillId },
      select: { id: true, grandTotal: true },
    });
    if (!bill) throw new Error("Parent bill missing");
    const liveRows = await tx.vendorBillPayment.findMany({
      where: { vendorBillId: bill.id, reversedAt: null },
      select: { amount: true },
    });
    const paid = liveRows.reduce((s, r) => s.plus(new Decimal(r.amount.toString())), new Decimal(0));
    const grand = new Decimal(bill.grandTotal.toString());
    const fullyPaid = paid.gte(grand);
    await tx.vendorBill.update({
      where: { id: bill.id },
      data: {
        amountPaid: paid.toDecimalPlaces(2).toString(),
        paidAt: fullyPaid ? new Date() : null,
        status: fullyPaid ? VendorBillStatus.PAID : VendorBillStatus.APPROVED,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_BILL_PAYMENT_REVERSED",
        entity: "VendorBillPayment",
        entityId: payment.id,
        payloadHash: sha256Json({ reason: input.reason }),
      },
    });
  });
  revalidatePath("/payments/payables");
}

export async function listPayablePayments(limit = 100) {
  await requireRole(WRITE_ROLES);
  return db.vendorBillPayment.findMany({
    where: { reversedAt: null },
    orderBy: { paidAt: "desc" },
    take: limit,
    include: {
      vendorBill: { select: { id: true, billNo: true, vendor: { select: { name: true } } } },
      recordedBy: { select: { name: true } },
    },
  });
}
