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
import { requireRole } from "@/server/rbac";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import {
  CustomerInvoicePaymentInput,
  PaymentReversalInput,
  VendorBillPaymentInput,
} from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { overpayRefusal, payRefusal } from "@/lib/vendor-bill-gates";
import { paymentRefusal, settledStatus } from "@/lib/customer-invoice-gates";
import type { Prisma } from "@prisma/client";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];

/**
 * FOR UPDATE row locks. A payment record/reversal reads the sum of live
 * payment rows, recomputes amountPaid + status, then writes back. Without
 * the lock two concurrent recordings read the same prior-payments snapshot,
 * both slip the over-recording guard, and the last write wins with a wrong
 * amountPaid. The lock serialises them: the second caller waits, then reads
 * the committed state.
 */
async function lockCustomerInvoiceRow(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "CustomerInvoice" WHERE "id" = ${id} FOR UPDATE`;
}
async function lockVendorBillRow(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "VendorBill" WHERE "id" = ${id} FOR UPDATE`;
}

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
export async function recordCustomerInvoicePayment(
  raw: unknown,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordCustomerInvoicePaymentInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordCustomerInvoicePaymentInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = CustomerInvoicePaymentInput.parse(raw);
  if (toDecimal(input.amount).lte(0)) throw new ActionError("Amount must be positive");

  const result = await db.$transaction(async (tx) => {
    // H2: lock the invoice before reading payment sums so concurrent
    // recordings serialise (else both slip the over-recording guard below).
    await lockCustomerInvoiceRow(tx, input.invoiceId);
    const invoice = await tx.customerInvoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true, invoiceNo: true, kind: true, status: true, grandTotal: true, orderId: true,
        onHoldAt: true, onHoldReason: true,
      },
    });
    if (!invoice) throw new ActionError("Invoice not found");
    // A proforma is an estimate, not a receivable — settling one used to
    // close the order as paid before anyone had cooked it.
    const kindRefusal = paymentRefusal({ invoiceNo: invoice.invoiceNo, kind: invoice.kind });
    if (kindRefusal) throw new ActionError(kindRefusal);
    // Billing hold — wrong address / wrong client / wrong items / payment
    // dispute. No payments can land until accounts releases the hold.
    if (invoice.onHoldAt) {
      throw new ActionError(
        `Invoice is on hold: ${invoice.onHoldReason ?? "no reason recorded"} — release the hold first`,
      );
    }
    if (
      invoice.status !== CustomerInvoiceStatus.ISSUED &&
      invoice.status !== CustomerInvoiceStatus.PARTIAL
    ) {
      throw new ActionError(`Cannot record payment on invoice in status ${invoice.status}`);
    }

    // Guardrail: block over-recording. If this payment would push total
    // recorded above the invoice grand total, stop — it's almost always a
    // duplicate entry (seen live: one invoice recorded three times).
    const priorRows = await tx.customerInvoicePayment.findMany({
      where: { invoiceId: invoice.id, reversedAt: null },
      select: { amount: true },
    });
    const priorPaid = priorRows.reduce((s, r) => s.plus(toDecimal(r.amount)), new Decimal(0));
    const grandTotal = toDecimal(invoice.grandTotal);
    const wouldBe = priorPaid.plus(toDecimal(input.amount));
    if (wouldBe.gt(grandTotal)) {
      throw new ActionError(
        `Recorded payments would be ₹${wouldBe.toFixed(2)} on a ₹${grandTotal.toFixed(2)} invoice ` +
          `(₹${priorPaid.toFixed(2)} already recorded). Check for a duplicate payment.`,
      );
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
      // Invoice fully settled → the order is done. COMPLETED is the terminal
      // state; PAID is a legacy resting point handled by the manual "Close
      // order" button for orders settled before this flip existed.
      await tx.order.update({
        where: { id: invoice.orderId },
        data: { status: OrderStatus.COMPLETED },
      });
    } else if (fullyPaid && invoice.orderId === null) {
      // H5: consolidated folio invoice — settlement closes every member order
      // it billed. Guarded INVOICED → COMPLETED (partial leaves them INVOICED).
      await tx.order.updateMany({
        where: { consolidatedInvoiceId: invoice.id, status: OrderStatus.INVOICED },
        data: { status: OrderStatus.COMPLETED },
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
  return { ok: true, id: result.id };
}

export async function reverseCustomerInvoicePayment(raw: unknown): Promise<ActionResult> {
  try {
    return await reverseCustomerInvoicePaymentInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function reverseCustomerInvoicePaymentInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = PaymentReversalInput.parse(raw);

  await db.$transaction(async (tx) => {
    const payment = await tx.customerInvoicePayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, invoiceId: true, reversedAt: true },
    });
    if (!payment) throw new ActionError("Payment not found");
    if (payment.reversedAt) throw new ActionError("Payment is already reversed");

    // H2: lock the parent invoice before mutating payments + recomputing, so
    // a concurrent record/reverse on the same invoice can't race the sum.
    await lockCustomerInvoiceRow(tx, payment.invoiceId);

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
      select: { id: true, grandTotal: true, orderId: true, status: true },
    });
    if (!invoice) throw new ActionError("Parent invoice missing");
    const liveRows = await tx.customerInvoicePayment.findMany({
      where: { invoiceId: invoice.id, reversedAt: null },
      select: { amount: true },
    });
    const paid = liveRows.reduce((s, r) => s.plus(new Decimal(r.amount.toString())), new Decimal(0));
    const grand = new Decimal(invoice.grandTotal.toString());
    const fullyPaid = paid.gte(grand);
    // A DRAFT carrying cash collected at the door is still a draft: pulling
    // that money back must never promote it to ISSUED, which would release an
    // invoice no manager signed off. Its status is settled at issue instead.
    const stillDraft = invoice.status === CustomerInvoiceStatus.DRAFT;

    await tx.customerInvoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: paid.toDecimalPlaces(2).toString(),
        paidAt: fullyPaid && !stillDraft ? new Date() : null,
        ...(stillDraft
          ? {}
          : { status: settledStatus(paid.toDecimalPlaces(2).toString(), grand.toString()) }),
      },
    });

    // If the order had auto-flipped to PAID/COMPLETED on full settlement,
    // demote it back to INVOICED now that a payment has been pulled.
    if (invoice.orderId && !fullyPaid) {
      const orderNow = await tx.order.findUnique({
        where: { id: invoice.orderId },
        select: { status: true },
      });
      if (
        orderNow?.status === OrderStatus.PAID ||
        orderNow?.status === OrderStatus.COMPLETED
      ) {
        await tx.order.update({
          where: { id: invoice.orderId },
          data: { status: OrderStatus.INVOICED },
        });
      }
    } else if (invoice.orderId === null && !fullyPaid) {
      // H5: consolidated folio invoice — a reversal below the full amount
      // re-opens its members. Mirror the single-order path: COMPLETED → INVOICED.
      await tx.order.updateMany({
        where: { consolidatedInvoiceId: invoice.id, status: OrderStatus.COMPLETED },
        data: { status: OrderStatus.INVOICED },
      });
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
  return { ok: true };
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

export async function recordVendorBillPayment(
  raw: unknown,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordVendorBillPaymentInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordVendorBillPaymentInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = VendorBillPaymentInput.parse(raw);
  if (toDecimal(input.amount).lte(0)) throw new ActionError("Amount must be positive");

  const result = await db.$transaction(async (tx) => {
    // H2: lock the bill before reading payment sums so concurrent recordings
    // serialise and the over-payment guard below can't be slipped.
    await lockVendorBillRow(tx, input.billId);
    const bill = await tx.vendorBill.findUnique({
      where: { id: input.billId },
      select: { id: true, billNo: true, status: true, grandTotal: true },
    });
    if (!bill) throw new ActionError("Bill not found");
    // Accounts approve the supplier's invoice, and only then is it payable —
    // a MATCHED (never signed off) or DISCREPANCY bill is not, however old
    // the browser tab that posted this is.
    const refusal = payRefusal(bill.billNo, bill.status);
    if (refusal) throw new ActionError(refusal);
    // H2: over-payment guard (was missing on the vendor side) — mirror the
    // customer-invoice guard. Sum live payments, refuse anything over balance.
    const priorRows = await tx.vendorBillPayment.findMany({
      where: { vendorBillId: bill.id, reversedAt: null },
      select: { amount: true },
    });
    const priorPaid = priorRows.reduce((s, r) => s.plus(toDecimal(r.amount)), new Decimal(0));
    const overpay = overpayRefusal(input.amount, bill.grandTotal.toString(), priorPaid.toString());
    if (overpay) throw new ActionError(overpay);
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
  return { ok: true, id: result.id };
}

export async function reverseVendorBillPayment(raw: unknown): Promise<ActionResult> {
  try {
    return await reverseVendorBillPaymentInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function reverseVendorBillPaymentInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = PaymentReversalInput.parse(raw);

  await db.$transaction(async (tx) => {
    const payment = await tx.vendorBillPayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, vendorBillId: true, reversedAt: true },
    });
    if (!payment) throw new ActionError("Payment not found");
    if (payment.reversedAt) throw new ActionError("Payment already reversed");
    // H2: lock the parent bill before mutating payments + recomputing.
    await lockVendorBillRow(tx, payment.vendorBillId);
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
    if (!bill) throw new ActionError("Parent bill missing");
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
  return { ok: true };
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
