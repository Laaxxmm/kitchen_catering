"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import {
  CustomerInvoiceKind,
  CustomerInvoiceStatus,
  EInvoiceStatus,
  OrderStatus,
  Role,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  AuthorizationError,
  requireRole,
  requireSession,
} from "@/server/rbac";
import { nextCustomerInvoiceNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { summarise } from "@/lib/gst";
import { indefineGstin, indefineCompanyName, indefineStateCode } from "@/lib/org";
import { eInvoiceEnabled, getEInvoiceProvider } from "@/server/services/e-invoice/provider";
import type { Prisma } from "@prisma/client";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.ACCOUNTS, Role.KITCHEN_HEAD, Role.STORE_KEEPER,
];

function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Create a DRAFT customer invoice from a DELIVERED order. Copies line items
 * one-to-one from the order, computes GST split (CGST+SGST if supplier state
 * == buyer state, else IGST), and snapshots totals.
 *
 * e-invoicing fields stay NOT_REQUIRED until Phase 3 wires the GSP.
 */
export async function createCustomerInvoiceFromOrder(orderId: string) {
  const session = await requireRole(WRITE_ROLES);

  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { dish: { select: { name: true, unit: true, hsnSac: true } } }, orderBy: { sortOrder: "asc" } },
        customer: { select: { id: true } },
      },
    });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.DELIVERED) {
      throw new AuthorizationError(`Cannot invoice order in status ${order.status}`);
    }
    // Disallow duplicates: one ORDER-kind invoice per order in Phase 1.
    const existing = await tx.customerInvoice.findFirst({
      where: { orderId, kind: CustomerInvoiceKind.ORDER },
    });
    if (existing) {
      throw new Error(`Order already has an invoice: ${existing.invoiceNo}`);
    }

    const supplierState = indefineStateCode();
    const lines = order.items.map((it) => ({
      quantity: it.portions.toString(),
      unitPrice: it.unitPrice.toString(),
      discountPct: it.discountPct.toString(),
      gstRatePct: it.gstRatePct.toString(),
    }));
    const summary = summarise({
      lines,
      supplierStateCode: supplierState,
      placeOfSupplyStateCode: order.placeOfSupplyStateCode,
    });

    const invoiceNo = await nextCustomerInvoiceNumber(tx);

    const invoice = await tx.customerInvoice.create({
      data: {
        invoiceNo,
        kind: CustomerInvoiceKind.ORDER,
        status: CustomerInvoiceStatus.DRAFT,
        orderId,
        customerId: order.customer.id,
        placeOfSupplyStateCode: order.placeOfSupplyStateCode,
        subtotal: summary.subtotal.toString(),
        cgst: summary.cgst.toString(),
        sgst: summary.sgst.toString(),
        igst: summary.igst.toString(),
        taxTotal: summary.taxTotal.toString(),
        grandTotal: summary.grandTotal.toString(),
        eInvoiceStatus: EInvoiceStatus.NOT_REQUIRED,
        createdById: session.user.id,
        shareToken: newShareToken(),
        lines: {
          create: order.items.map((it, idx) => {
            const lineSubtotal = it.lineSubtotal.toString();
            const lineTax = it.lineTax.toString();
            const lineTotal = it.lineTotal.toString();
            return {
              sortOrder: idx,
              description: it.dish.name,
              hsnSac: it.dish.hsnSac ?? null,
              quantity: it.portions.toString(),
              unit: it.dish.unit,
              unitPrice: it.unitPrice.toString(),
              discountPct: it.discountPct.toString(),
              gstRatePct: it.gstRatePct.toString(),
              lineSubtotal,
              lineTax,
              lineTotal,
            };
          }),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_CREATED",
        entity: "CustomerInvoice",
        entityId: invoice.id,
        payloadHash: sha256Json({ orderId, invoiceNo, grandTotal: summary.grandTotal.toString() }),
      },
    });

    return invoice;
  });

  revalidatePath("/invoices");
  revalidatePath(`/orders/${orderId}`);
  return { id: result.id, invoiceNo: result.invoiceNo };
}

export async function issueCustomerInvoice(id: string) {
  const session = await requireRole(WRITE_ROLES);
  const wantsEInvoice = await eInvoiceEnabled();

  await db.$transaction(async (tx) => {
    const invoice = await tx.customerInvoice.findUnique({
      where: { id },
      select: { status: true, orderId: true },
    });
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== CustomerInvoiceStatus.DRAFT) {
      throw new AuthorizationError(`Cannot issue an invoice in status ${invoice.status}`);
    }
    await tx.customerInvoice.update({
      where: { id },
      data: {
        status: CustomerInvoiceStatus.ISSUED,
        issuedAt: new Date(),
        eInvoiceStatus: wantsEInvoice ? EInvoiceStatus.PENDING : EInvoiceStatus.NOT_REQUIRED,
      },
    });
    if (invoice.orderId) {
      await tx.order.update({
        where: { id: invoice.orderId },
        data: { status: OrderStatus.INVOICED },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_ISSUED",
        entity: "CustomerInvoice",
        entityId: id,
      },
    });
  });

  // Out-of-transaction: kick off IRN generation. We do it inline (not a
  // queue) because the sandbox provider is synchronous and fast. Real
  // ClearTax integration would queue this.
  if (wantsEInvoice) {
    void generateIRNForInvoice(id);
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
}

// ─── E-Invoice generation (fire-and-forget after issue) ────────────────

async function generateIRNForInvoice(invoiceId: string): Promise<void> {
  const invoice = await db.customerInvoice.findUnique({
    where: { id: invoiceId },
    include: { customer: true },
  });
  if (!invoice) return;
  if (invoice.eInvoiceStatus !== EInvoiceStatus.PENDING) return;

  const provider = await getEInvoiceProvider();
  try {
    const result = await provider.generate({
      invoiceNo: invoice.invoiceNo,
      invoiceDate: invoice.issuedAt ?? invoice.createdAt,
      sellerGstin: indefineGstin(),
      sellerName: indefineCompanyName(),
      buyerGstin: invoice.customer.gstin ?? null,
      buyerName: invoice.customer.name,
      buyerStateCode: invoice.customer.stateCode,
      placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
      lineCount: 0,
      subtotal: invoice.subtotal.toString(),
      cgst: invoice.cgst.toString(),
      sgst: invoice.sgst.toString(),
      igst: invoice.igst.toString(),
      grandTotal: invoice.grandTotal.toString(),
    });
    await db.$transaction(async (tx) => {
      await tx.customerInvoice.update({
        where: { id: invoiceId },
        data: {
          eInvoiceStatus: EInvoiceStatus.GENERATED,
          irn: result.irn,
          ackNo: result.ackNo,
          ackDate: result.ackDate,
          signedQrPayload: result.signedQrPayload,
          signedInvoiceJson: result.signedInvoiceJson as Prisma.InputJsonValue,
        },
      });
      await tx.eInvoiceLog.create({
        data: {
          invoiceId,
          action: "GENERATE",
          provider: provider.name.toUpperCase(),
          success: true,
          responseJson: result.signedInvoiceJson as Prisma.InputJsonValue,
        },
      });
    });
  } catch (err) {
    await db.eInvoiceLog.create({
      data: {
        invoiceId,
        action: "GENERATE",
        provider: provider.name.toUpperCase(),
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    await db.customerInvoice.update({
      where: { id: invoiceId },
      data: { eInvoiceStatus: EInvoiceStatus.FAILED },
    });
  }
}

export async function cancelCustomerInvoiceEInvoice(invoiceId: string, reason: string) {
  const session = await requireRole([Role.ADMIN, Role.ACCOUNTS]);
  if (!reason.trim()) throw new Error("Reason required");

  const invoice = await db.customerInvoice.findUnique({
    where: { id: invoiceId },
    select: { eInvoiceStatus: true, irn: true, ackDate: true },
  });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.eInvoiceStatus !== EInvoiceStatus.GENERATED || !invoice.irn) {
    throw new Error("Invoice does not have a GENERATED IRN to cancel");
  }
  const hoursSinceAck = invoice.ackDate
    ? (Date.now() - invoice.ackDate.getTime()) / (60 * 60 * 1000)
    : 999;
  if (hoursSinceAck > 24) {
    throw new Error("IRN can only be cancelled within 24 hours of issue. Issue a credit note instead.");
  }

  const provider = await getEInvoiceProvider();
  await provider.cancel(invoice.irn, reason);

  await db.$transaction(async (tx) => {
    await tx.customerInvoice.update({
      where: { id: invoiceId },
      data: { eInvoiceStatus: EInvoiceStatus.CANCELLED },
    });
    await tx.eInvoiceLog.create({
      data: {
        invoiceId,
        action: "CANCEL",
        provider: provider.name.toUpperCase(),
        success: true,
        errorMessage: null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_EINVOICE_CANCELLED",
        entity: "CustomerInvoice",
        entityId: invoiceId,
        payloadHash: sha256Json({ reason }),
      },
    });
  });
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function cancelCustomerInvoice(id: string, reason: string) {
  const session = await requireRole([Role.ADMIN, Role.MANAGER]);
  if (!reason.trim()) throw new Error("Reason required");
  await db.$transaction(async (tx) => {
    await tx.customerInvoice.update({
      where: { id },
      data: { status: CustomerInvoiceStatus.CANCELLED },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_CANCELLED",
        entity: "CustomerInvoice",
        entityId: id,
        payloadHash: sha256Json({ reason }),
      },
    });
  });
  revalidatePath(`/invoices/${id}`);
}

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listCustomerInvoices(opts: { status?: CustomerInvoiceStatus[]; customerId?: string } = {}) {
  await requireRole(READ_ROLES);
  return db.customerInvoice.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
    },
    include: {
      customer: { select: { name: true } },
      order: { select: { code: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getCustomerInvoice(id: string) {
  await requireSession();
  return db.customerInvoice.findUnique({
    where: { id },
    include: {
      customer: true,
      order: { select: { id: true, code: true } },
      createdBy: { select: { name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      payments: {
        where: { reversedAt: null },
        orderBy: { paidAt: "desc" },
        include: { recordedBy: { select: { name: true } } },
      },
    },
  });
}

export async function getCustomerInvoiceByToken(token: string) {
  return db.customerInvoice.findUnique({
    where: { shareToken: token },
    include: {
      customer: { select: { name: true, billingAddress: true, gstin: true, stateCode: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      order: { select: { code: true, eventDate: true } },
    },
  });
}
