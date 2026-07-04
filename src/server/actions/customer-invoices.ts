"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  CustomerInvoiceKind,
  CustomerInvoiceStatus,
  EInvoiceStatus,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  Role,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  AuthorizationError,
  requireRole,
  requireSession,
} from "@/server/rbac";
import { isImmediateChannel } from "@/lib/order-channels";
import { nextCustomerInvoiceNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { summarise } from "@/lib/gst";
import { toDecimal } from "@/lib/money";
import { indefineGstin, indefineCompanyName, indefineStateCode } from "@/lib/org";
import { eInvoiceEnabled, getEInvoiceProvider } from "@/server/services/e-invoice/provider";
import { buildInvoiceEmail, sendEmail } from "@/lib/email";
import { formatIST } from "@/lib/time";
import { notifyRoles } from "@/server/actions/notifications";
import type { Prisma } from "@prisma/client";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];
// F&B Service (DELIVERY / retired alias FNB_SERVICE) can view generated
// bills — the middleware admits them to /invoices/[id] for room-service
// billing, so the read gate must match or the page crashes for them.
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.ACCOUNTS, Role.KITCHEN_HEAD, Role.STORE_KEEPER,
  Role.DELIVERY, Role.FNB_SERVICE,
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
        // Pull any payment captured at the door so we credit it against
        // the new tax invoice automatically.
        deliveries: {
          where: { paymentCollected: true },
          select: { id: true, paymentAmount: true, paymentMethod: true, paymentReference: true },
        },
      },
    });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.DELIVERED) {
      throw new AuthorizationError(`Cannot invoice order in status ${order.status}`);
    }
    // Guardrail: one non-cancelled TAX invoice per order. The auto-generated
    // PROFORMA (kind PROFORMA) is informational and must NOT block creating
    // the real tax invoice — only an existing ORDER-kind invoice does. A
    // cancelled one doesn't block re-invoicing. (Seen live: ORD → two invoices.)
    const existing = await tx.customerInvoice.findFirst({
      where: {
        orderId,
        kind: CustomerInvoiceKind.ORDER,
        status: { not: CustomerInvoiceStatus.CANCELLED },
      },
    });
    if (existing) {
      throw new Error(`${order.code} already has invoice ${existing.invoiceNo} — cancel it first to re-invoice.`);
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

    // Sum payments collected at the door for this order.
    const podTotal = order.deliveries.reduce(
      (s, d) => s.plus(d.paymentAmount ? toDecimal(d.paymentAmount) : 0),
      new Decimal(0),
    );
    const fullyPaidAtDelivery = podTotal.gte(summary.grandTotal);
    const partiallyPaidAtDelivery = podTotal.gt(0) && !fullyPaidAtDelivery;

    const invoice = await tx.customerInvoice.create({
      data: {
        invoiceNo,
        kind: CustomerInvoiceKind.ORDER,
        // Invoice is created in ISSUED status — the GST document is now
        // canonical for this order. Status flips to PAID/PARTIAL below
        // if there was a payment-on-delivery.
        status: fullyPaidAtDelivery
          ? CustomerInvoiceStatus.PAID
          : partiallyPaidAtDelivery
            ? CustomerInvoiceStatus.PARTIAL
            : CustomerInvoiceStatus.ISSUED,
        issuedAt: new Date(),
        amountPaid: podTotal.toFixed(2),
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

    // Materialise each payment-on-delivery as a CustomerInvoicePayment
    // row so the ledger / reports tally cleanly.
    for (const d of order.deliveries) {
      if (!d.paymentAmount || !d.paymentMethod) continue;
      await tx.customerInvoicePayment.create({
        data: {
          invoiceId: invoice.id,
          amount: d.paymentAmount,
          paidAt: new Date(),
          // Delivery.paymentMethod is stored as a free-text string for
          // historical reasons. Cast into the PaymentMethod enum used
          // by CustomerInvoicePayment.
          method: d.paymentMethod as PaymentMethod,
          reference: d.paymentReference,
          notes: "Collected at delivery",
          recordedById: session.user.id,
        },
      });
    }

    // Order advances DELIVERED → INVOICED (or PAID if fully settled at door).
    await tx.order.update({
      where: { id: orderId },
      data: { status: fullyPaidAtDelivery ? OrderStatus.PAID : OrderStatus.INVOICED },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_CREATED",
        entity: "CustomerInvoice",
        entityId: invoice.id,
        payloadHash: sha256Json({
          orderId,
          invoiceNo,
          grandTotal: summary.grandTotal.toString(),
          podTotal: podTotal.toString(),
        }),
      },
    });

    return invoice;
  });

  revalidatePath("/invoices");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/invoices/${result.id}`);
  return { id: result.id, invoiceNo: result.invoiceNo };
}

// ─── Proforma invoice (workflow v2) ─────────────────────────────────────

/**
 * Auto-creates a PROFORMA invoice when an order reaches CHEF_APPROVED /
 * CHEF_REQUISITION_PENDING. Idempotent on (orderId, kind=PROFORMA). After
 * creating, attempts to email it to the customer (best-effort; failures
 * are logged but don't throw, so the order workflow isn't held up by
 * SMTP issues).
 *
 * Called from inside the chef-approval server actions (post-commit).
 * Not exposed as a button — the system runs it automatically.
 */
export async function createProformaInvoiceForOrder(orderId: string) {
  // No requireRole — this is called from inside server actions that
  // already enforced role. Anonymous-but-server-side call.

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { dish: { select: { name: true, unit: true, hsnSac: true } } }, orderBy: { sortOrder: "asc" } },
      customer: true,
    },
  });
  if (!order) throw new Error("Order not found");
  if (order.items.length === 0) return null;

  // Idempotency: skip if a PROFORMA already exists for this order.
  const existing = await db.customerInvoice.findFirst({
    where: { orderId, kind: CustomerInvoiceKind.PROFORMA, status: { not: CustomerInvoiceStatus.CANCELLED } },
    select: { id: true, invoiceNo: true, shareToken: true },
  });
  let invoice: { id: string; invoiceNo: string; shareToken: string };
  if (existing) {
    invoice = existing;
  } else {
    const supplierState = indefineStateCode();
    const summary = summarise({
      lines: order.items.map((it) => ({
        quantity: it.portions.toString(),
        unitPrice: it.unitPrice.toString(),
        discountPct: it.discountPct.toString(),
        gstRatePct: it.gstRatePct.toString(),
      })),
      supplierStateCode: supplierState,
      placeOfSupplyStateCode: order.placeOfSupplyStateCode,
    });

    const created = await db.$transaction(async (tx) => {
      const invoiceNo = await nextCustomerInvoiceNumber(tx);
      const row = await tx.customerInvoice.create({
        data: {
          invoiceNo,
          kind: CustomerInvoiceKind.PROFORMA,
          // Proforma is informational only; it lands as ISSUED so the
          // public token URL surfaces it immediately, but eInvoiceStatus
          // stays NOT_REQUIRED — proformas never get an IRN.
          status: CustomerInvoiceStatus.ISSUED,
          issuedAt: new Date(),
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
          createdById: order.createdById,
          shareToken: newShareToken(),
          lines: {
            create: order.items.map((it, idx) => ({
              sortOrder: idx,
              description: it.dish.name,
              hsnSac: it.dish.hsnSac ?? null,
              quantity: it.portions.toString(),
              unit: it.dish.unit,
              unitPrice: it.unitPrice.toString(),
              discountPct: it.discountPct.toString(),
              gstRatePct: it.gstRatePct.toString(),
              lineSubtotal: it.lineSubtotal.toString(),
              lineTax: it.lineTax.toString(),
              lineTotal: it.lineTotal.toString(),
            })),
          },
        },
        select: { id: true, invoiceNo: true, shareToken: true },
      });
      await tx.auditLog.create({
        data: {
          userId: order.createdById,
          action: "CUSTOMER_INVOICE_PROFORMA_AUTO_CREATED",
          entity: "CustomerInvoice",
          entityId: row.id,
          payloadHash: sha256Json({ orderId, kind: "PROFORMA", grandTotal: summary.grandTotal.toString() }),
        },
      });
      return row;
    });
    invoice = created;
  }

  // Best-effort email. Logged + swallowed on failure.
  if (order.customer.email) {
    try {
      const { sendEmail, buildInvoiceEmail } = await import("@/lib/email");
      const { renderCustomerInvoicePDF } = await import("@/server/pdf/customer-invoice");
      const fullInvoice = await db.customerInvoice.findUnique({
        where: { id: invoice.id },
        include: { lines: { orderBy: { sortOrder: "asc" } }, order: { select: { code: true, eventDate: true } } },
      });
      if (!fullInvoice) throw new Error("Just-created proforma vanished");
      const pdf = await renderCustomerInvoicePDF({
        invoiceNo: fullInvoice.invoiceNo,
        issuedAt: fullInvoice.issuedAt,
        dueAt: fullInvoice.dueAt,
        orderCode: fullInvoice.order?.code ?? null,
        placeOfSupplyStateCode: fullInvoice.placeOfSupplyStateCode,
        irn: fullInvoice.irn,
        ackNo: fullInvoice.ackNo,
        ackDate: fullInvoice.ackDate,
        customer: {
          name: order.customer.name,
          gstin: order.customer.gstin,
          billingAddress: order.customer.billingAddress,
          stateCode: order.customer.stateCode,
        },
        lines: fullInvoice.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity.toString(),
          unit: l.unit,
          unitPrice: l.unitPrice.toString(),
          gstRatePct: l.gstRatePct.toString(),
          lineTotal: l.lineTotal.toString(),
        })),
        subtotal: fullInvoice.subtotal.toString(),
        cgst: fullInvoice.cgst.toString(),
        sgst: fullInvoice.sgst.toString(),
        igst: fullInvoice.igst.toString(),
        taxTotal: fullInvoice.taxTotal.toString(),
        grandTotal: fullInvoice.grandTotal.toString(),
        amountPaid: fullInvoice.amountPaid.toString(),
        notes: fullInvoice.notes,
        terms: fullInvoice.termsMd,
      });
      const publicBase = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
      const composed = buildInvoiceEmail({
        invoiceNo: invoice.invoiceNo,
        invoiceKind: "PROFORMA",
        customerName: order.customer.name,
        grandTotal: fullInvoice.grandTotal.toString(),
        eventDateLabel: order.eventDate.toISOString().slice(0, 10),
        publicUrl: `${publicBase}/i/${invoice.shareToken}`,
      });
      await sendEmail({
        to: order.customer.email,
        subject: composed.subject,
        text: composed.text,
        html: composed.html,
        attachments: [
          {
            filename: `${invoice.invoiceNo}.pdf`,
            content: pdf,
            contentType: "application/pdf",
          },
        ],
      });
      await db.customerInvoice.update({
        where: { id: invoice.id },
        data: { emailedAt: new Date(), emailedTo: order.customer.email },
      });
    } catch (err) {
      console.error(`[proforma email] failed for invoice ${invoice.invoiceNo}:`, err);
    }
  } else {
    console.error(`[proforma email] no customer email on file for ${order.customer.name}; PDF created but not sent`);
  }

  return invoice;
}

// ─── Standalone invoice (ad-hoc, no order) ──────────────────────────────

interface StandaloneLineInput {
  description: string;
  hsnSac?: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPct?: string;
  gstRatePct?: string;
}

interface StandaloneInvoiceInput {
  customerId: string;
  placeOfSupplyStateCode: string;
  dueDate?: string | null;
  notes?: string | null;
  termsMd?: string | null;
  poRef?: string | null;
  lines: StandaloneLineInput[];
}

export async function createStandaloneCustomerInvoice(raw: StandaloneInvoiceInput) {
  const session = await requireRole(WRITE_ROLES);
  if (!raw.customerId) throw new Error("Customer is required");
  if (!raw.lines || raw.lines.length === 0) throw new Error("Add at least one line");

  const result = await db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: raw.customerId },
      select: { id: true },
    });
    if (!customer) throw new Error("Customer not found");

    const supplierState = indefineStateCode();
    const summary = summarise({
      lines: raw.lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct ?? "0",
        gstRatePct: l.gstRatePct ?? "0",
      })),
      supplierStateCode: supplierState,
      placeOfSupplyStateCode: raw.placeOfSupplyStateCode,
    });

    const invoiceNo = await nextCustomerInvoiceNumber(tx);
    const invoice = await tx.customerInvoice.create({
      data: {
        invoiceNo,
        kind: CustomerInvoiceKind.ADHOC,
        status: CustomerInvoiceStatus.DRAFT,
        orderId: null,
        customerId: raw.customerId,
        placeOfSupplyStateCode: raw.placeOfSupplyStateCode,
        subtotal: summary.subtotal.toString(),
        cgst: summary.cgst.toString(),
        sgst: summary.sgst.toString(),
        igst: summary.igst.toString(),
        taxTotal: summary.taxTotal.toString(),
        grandTotal: summary.grandTotal.toString(),
        eInvoiceStatus: EInvoiceStatus.NOT_REQUIRED,
        createdById: session.user.id,
        shareToken: newShareToken(),
        dueAt: raw.dueDate ? new Date(raw.dueDate) : null,
        notes: raw.notes ?? null,
        termsMd: raw.termsMd ?? null,
        poRef: raw.poRef ?? null,
        lines: {
          create: raw.lines.map((l, idx) => {
            const q = new Decimal(l.quantity);
            const u = new Decimal(l.unitPrice);
            const d = new Decimal(l.discountPct ?? "0").div(100);
            const g = new Decimal(l.gstRatePct ?? "0").div(100);
            const sub = q.times(u).times(new Decimal(1).minus(d));
            const tax = sub.times(g);
            return {
              sortOrder: idx,
              description: l.description,
              hsnSac: l.hsnSac ?? null,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct ?? "0",
              gstRatePct: l.gstRatePct ?? "0",
              lineSubtotal: sub.toDecimalPlaces(2).toString(),
              lineTax: tax.toDecimalPlaces(2).toString(),
              lineTotal: sub.plus(tax).toDecimalPlaces(2).toString(),
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
        payloadHash: sha256Json({ invoiceNo, kind: "ADHOC", grandTotal: summary.grandTotal.toString() }),
      },
    });
    return invoice;
  });

  revalidatePath("/invoices");
  return { id: result.id, invoiceNo: result.invoiceNo };
}

// ─── Edit lines on a DRAFT invoice ──────────────────────────────────────

interface EditInvoiceInput {
  placeOfSupplyStateCode?: string;
  dueDate?: string | null;
  notes?: string | null;
  termsMd?: string | null;
  poRef?: string | null;
  lines: StandaloneLineInput[];
}

export async function updateDraftInvoice(id: string, input: EditInvoiceInput) {
  const session = await requireRole(WRITE_ROLES);
  if (!input.lines || input.lines.length === 0) throw new Error("Add at least one line");

  await db.$transaction(async (tx) => {
    const inv = await tx.customerInvoice.findUnique({
      where: { id },
      select: { id: true, status: true, placeOfSupplyStateCode: true },
    });
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== CustomerInvoiceStatus.DRAFT) {
      throw new AuthorizationError("Only DRAFT invoices can be edited. Cancel and re-create to amend a non-draft.");
    }

    const supplierState = indefineStateCode();
    const pos = input.placeOfSupplyStateCode ?? inv.placeOfSupplyStateCode;
    const summary = summarise({
      lines: input.lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct ?? "0",
        gstRatePct: l.gstRatePct ?? "0",
      })),
      supplierStateCode: supplierState,
      placeOfSupplyStateCode: pos,
    });

    // Replace all lines (simpler than diffing for the DRAFT case).
    await tx.customerInvoiceLine.deleteMany({ where: { invoiceId: id } });
    await tx.customerInvoiceLine.createMany({
      data: input.lines.map((l, idx) => {
        const q = new Decimal(l.quantity);
        const u = new Decimal(l.unitPrice);
        const d = new Decimal(l.discountPct ?? "0").div(100);
        const g = new Decimal(l.gstRatePct ?? "0").div(100);
        const sub = q.times(u).times(new Decimal(1).minus(d));
        const tax = sub.times(g);
        return {
          invoiceId: id,
          sortOrder: idx,
          description: l.description,
          hsnSac: l.hsnSac ?? null,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct ?? "0",
          gstRatePct: l.gstRatePct ?? "0",
          lineSubtotal: sub.toDecimalPlaces(2).toString(),
          lineTax: tax.toDecimalPlaces(2).toString(),
          lineTotal: sub.plus(tax).toDecimalPlaces(2).toString(),
        };
      }),
    });

    await tx.customerInvoice.update({
      where: { id },
      data: {
        placeOfSupplyStateCode: pos,
        dueAt: input.dueDate ? new Date(input.dueDate) : null,
        notes: input.notes ?? null,
        termsMd: input.termsMd ?? null,
        poRef: input.poRef ?? null,
        subtotal: summary.subtotal.toString(),
        cgst: summary.cgst.toString(),
        sgst: summary.sgst.toString(),
        igst: summary.igst.toString(),
        taxTotal: summary.taxTotal.toString(),
        grandTotal: summary.grandTotal.toString(),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_DRAFT_UPDATED",
        entity: "CustomerInvoice",
        entityId: id,
        payloadHash: sha256Json({ lines: input.lines.length, grandTotal: summary.grandTotal.toString() }),
      },
    });
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
}

/**
 * System-triggered tax invoice creation. Called from confirmDelivery
 * the moment an order is marked DELIVERED, so the customer's GST invoice
 * is ready without anyone clicking a button.
 *
 * - Idempotent: returns the existing ORDER invoice id if one was already
 *   created (so this is safe to call multiple times from the same flow).
 * - Creates the invoice as ISSUED (not DRAFT) — the order is delivered,
 *   nothing is going to change about the line items now.
 * - Advances the order status from DELIVERED to INVOICED.
 * - Best-effort emails the invoice PDF to the customer.
 *
 * Must run inside a transaction. Returns the invoice id + invoiceNo so
 * the caller can bind a payment to it in the same transaction.
 */
export async function createTaxInvoiceForOrderInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  userId: string,
): Promise<{ id: string; invoiceNo: string; grandTotal: string; created: boolean }> {
  // Idempotency: short-circuit if an ORDER invoice already exists.
  const existing = await tx.customerInvoice.findFirst({
    where: { orderId, kind: CustomerInvoiceKind.ORDER },
    select: { id: true, invoiceNo: true, grandTotal: true },
  });
  if (existing) {
    return { id: existing.id, invoiceNo: existing.invoiceNo, grandTotal: existing.grandTotal.toString(), created: false };
  }

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { dish: { select: { name: true, unit: true, hsnSac: true } } }, orderBy: { sortOrder: "asc" } },
      customer: { select: { id: true } },
    },
  });
  if (!order) throw new Error("Order not found");

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
      // Create ISSUED, not DRAFT — delivery is done, no edits expected.
      status: CustomerInvoiceStatus.ISSUED,
      issuedAt: new Date(),
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
      createdById: userId,
      shareToken: newShareToken(),
      lines: {
        create: order.items.map((it, idx) => ({
          sortOrder: idx,
          description: it.dish.name,
          hsnSac: it.dish.hsnSac ?? null,
          quantity: it.portions.toString(),
          unit: it.dish.unit,
          unitPrice: it.unitPrice.toString(),
          discountPct: it.discountPct.toString(),
          gstRatePct: it.gstRatePct.toString(),
          lineSubtotal: it.lineSubtotal.toString(),
          lineTax: it.lineTax.toString(),
          lineTotal: it.lineTotal.toString(),
        })),
      },
    },
    select: { id: true, invoiceNo: true, grandTotal: true },
  });

  // Order advances DELIVERED → INVOICED in the same transaction.
  await tx.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.INVOICED },
  });

  await tx.auditLog.create({
    data: {
      userId,
      action: "CUSTOMER_INVOICE_AUTO_CREATED_ON_DELIVERY",
      entity: "CustomerInvoice",
      entityId: invoice.id,
      payloadHash: sha256Json({ orderId, invoiceNo: invoice.invoiceNo, grandTotal: invoice.grandTotal.toString() }),
    },
  });

  return { id: invoice.id, invoiceNo: invoice.invoiceNo, grandTotal: invoice.grandTotal.toString(), created: true };
}

/**
 * Best-effort email of a freshly-issued tax invoice. Runs post-commit so
 * SMTP latency doesn't hold the delivery confirmation transaction open.
 * Failures are logged and swallowed; the invoice still exists in the
 * system and can be re-sent manually if the customer never receives it.
 */
export async function emailTaxInvoice(
  invoiceId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  try {
    const invoice = await db.customerInvoice.findUnique({
      where: { id: invoiceId },
      include: { customer: true, order: { select: { eventDate: true } } },
    });
    if (!invoice) return;
    if (!invoice.customer.email) {
      // No email on file — surface this if it was a manual click. The
      // user is responsible for handling missing-email customers.
      if (opts.force) {
        throw new Error("Customer has no email on file. Add one on the customer page first.");
      }
      return;
    }
    // Silent skip when called as the auto-send pass; force=true means
    // the user clicked "Resend by email" deliberately.
    if (invoice.emailedAt && !opts.force) return;

    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const publicUrl = `${baseUrl}/i/${invoice.shareToken}`;
    const composed = buildInvoiceEmail({
      invoiceNo: invoice.invoiceNo,
      invoiceKind: "ORDER",
      customerName: invoice.customer.name,
      grandTotal: invoice.grandTotal.toString(),
      eventDateLabel: invoice.order?.eventDate
        ? formatIST(invoice.order.eventDate, "EEE d MMM yyyy")
        : undefined,
      publicUrl,
    });
    const sent = await sendEmail({
      to: invoice.customer.email,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
    });
    if (sent.provider !== "console" || process.env.EMAIL_LOG_BODY === "1") {
      await db.customerInvoice.update({
        where: { id: invoiceId },
        data: { emailedAt: new Date(), emailedTo: invoice.customer.email },
      });
    }
  } catch (err) {
    console.error(
      `[emailTaxInvoice ${invoiceId}] failed: ${err instanceof Error ? err.message : err}`,
    );
    // Re-throw on force so the UI can show the failure (e.g. no email on file).
    if (opts.force) throw err;
  }
}

/**
 * One-click "Mark paid" — records a single payment for the outstanding
 * balance, method `OTHER`, note "Marked paid (no detailed breakdown)".
 * Use this for the simple cash-on-bank-statement case where accounts
 * doesn't need to capture method/reference.
 *
 * For richer cases (split payments, TDS, etc.) accounts uses the
 * existing RecordPaymentForm.
 */
interface MarkPaidInput {
  invoiceId: string;
  /** Payment method recorded against the balance closure. */
  method: PaymentMethod;
  /** External reference — UPI ref / cheque no / NEFT ref. */
  reference?: string | null;
  /** ISO date string for the paidAt timestamp. Defaults to now. */
  paidAt?: string | null;
  /** Optional free-text notes. */
  notes?: string | null;
}

/**
 * One-shot "mark this invoice fully paid" with a proper payment record.
 *
 * Workflow doc: this used to default `method=OTHER` and leave the
 * reference blank, which the client flagged in the proforma screenshot.
 * Callers MUST now supply method + reference (popup on the invoice
 * page collects them).
 *
 * For partial payments use `recordCustomerInvoicePayment` instead.
 */
export async function markCustomerInvoicePaid(input: MarkPaidInput) {
  // Tighter gate than the rest of the WRITE_ROLES set — admin / manager
  // only. Accounts records detailed payments through the RecordPayment
  // form; this one-click action belongs to the people who can also
  // approve orders.
  const session = await requireRole([Role.ADMIN, Role.MANAGER]);
  const { invoiceId } = input;
  const paidAtDate = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAtDate.getTime())) {
    throw new Error("paidAt is not a valid date");
  }
  await db.$transaction(async (tx) => {
    const invoice = await tx.customerInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true, grandTotal: true, amountPaid: true, orderId: true },
    });
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === CustomerInvoiceStatus.PAID) {
      throw new Error("Invoice is already marked paid");
    }
    if (invoice.status === CustomerInvoiceStatus.CANCELLED) {
      throw new Error("Cannot mark a cancelled invoice paid");
    }
    if (invoice.status === CustomerInvoiceStatus.DRAFT) {
      throw new Error("Issue the invoice first, then mark it paid");
    }
    const balance = new Decimal(invoice.grandTotal.toString()).minus(invoice.amountPaid.toString());
    if (balance.lte(0)) {
      // Numeric edge — flip the status flag and we're done.
      await tx.customerInvoice.update({
        where: { id: invoiceId },
        data: { status: CustomerInvoiceStatus.PAID },
      });
    } else {
      await tx.customerInvoicePayment.create({
        data: {
          invoiceId,
          amount: balance.toFixed(2),
          paidAt: paidAtDate,
          method: input.method,
          reference: input.reference ?? null,
          recordedById: session.user.id,
          notes: input.notes ?? null,
        },
      });
      await tx.customerInvoice.update({
        where: { id: invoiceId },
        data: {
          amountPaid: invoice.grandTotal.toString(),
          status: CustomerInvoiceStatus.PAID,
        },
      });
    }
    // If the invoice belongs to an order, advance it to PAID too — the
    // commercial transaction is complete.
    if (invoice.orderId) {
      await tx.order.update({
        where: { id: invoice.orderId },
        data: { status: OrderStatus.PAID },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_MARKED_PAID",
        entity: "CustomerInvoice",
        entityId: invoiceId,
        payloadHash: sha256Json({ balanceCleared: balance.toString() }),
      },
    });
  });

  const invoiceAfter = await db.customerInvoice.findUnique({
    where: { id: invoiceId },
    select: { invoiceNo: true, customer: { select: { name: true } } },
  });
  if (invoiceAfter) {
    await notifyRoles([Role.SALES, Role.ACCOUNTS, Role.ADMIN, Role.MANAGER], {
      kind: "CUSTOMER_INVOICE_PAID",
      title: `Invoice ${invoiceAfter.invoiceNo} paid`,
      body: `${invoiceAfter.customer.name} cleared the balance.`,
      link: `/invoices/${invoiceId}`,
      dedupeKey: `customer-invoice-paid:${invoiceId}`,
    });
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/payments/receivables");
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

/**
 * Orders that are delivered and ready to be invoiced — i.e. DELIVERED and
 * without a non-cancelled customer invoice yet. Returned newest-first with
 * the customer attached, so the "Generate invoice" screen can group them
 * per client. (A DELIVERED order has no tax invoice by definition — issuing
 * one advances it to INVOICED — so status alone is the billable filter.)
 */
export async function listBillableOrders() {
  await requireRole(WRITE_ROLES);
  return db.order.findMany({
    where: { status: OrderStatus.DELIVERED },
    select: {
      id: true,
      code: true,
      channel: true,
      eventDate: true,
      contractValue: true,
      customer: { select: { id: true, name: true } },
    },
    orderBy: [{ customerId: "asc" }, { eventDate: "asc" }],
    take: 500,
  });
}

// Roles that can run the in-house (room service) billing screen — the front-
// of-house F&B staff who take those orders, plus finance/management.
const INHOUSE_BILL_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.FNB_SERVICE, Role.DELIVERY];

/**
 * Served-but-unbilled in-house orders (room service / à la carte /
 * management) for the room-service billing screen. Returned with room/table
 * + customer + a short item summary so the screen can group them per
 * room/guest and show the running total. "Served" = DELIVERED (set by the
 * one-tap markInHouseServed); issuing the bill advances it to INVOICED.
 */
export async function listBillableInHouseOrders() {
  await requireRole(INHOUSE_BILL_ROLES);
  return db.order.findMany({
    where: {
      status: OrderStatus.DELIVERED,
      channel: {
        in: [OrderChannel.ROOM_SERVICE, OrderChannel.ALACARTE, OrderChannel.MANAGEMENT],
      },
    },
    select: {
      id: true,
      code: true,
      channel: true,
      roomNumber: true,
      tableNumber: true,
      eventDate: true,
      contractValue: true,
      customer: { select: { id: true, name: true } },
      items: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, portions: true, dish: { select: { name: true } } },
      },
    },
    orderBy: [{ roomNumber: "asc" }, { eventDate: "asc" }],
    take: 500,
  });
}

/**
 * Consolidate several in-house orders for the SAME customer into ONE GST
 * invoice — the hotel-folio model. Merges every order's line items, computes
 * the GST split once (same customer ⇒ same place of supply), credits any
 * payment collected on the way, and advances all the orders to INVOICED.
 */
export async function createConsolidatedInHouseInvoice(orderIds: string[]) {
  const session = await requireRole(INHOUSE_BILL_ROLES);
  if (!orderIds || orderIds.length === 0) {
    throw new Error("Pick at least one order to bill.");
  }

  const result = await db.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        items: {
          include: { dish: { select: { name: true, unit: true, hsnSac: true } } },
          orderBy: { sortOrder: "asc" },
        },
        customer: { select: { id: true, name: true } },
        deliveries: {
          where: { paymentCollected: true },
          select: { paymentAmount: true, paymentMethod: true, paymentReference: true },
        },
      },
    });
    if (orders.length === 0) throw new Error("Orders not found.");

    const customerId = orders[0].customer.id;
    const pos = orders[0].placeOfSupplyStateCode;
    for (const o of orders) {
      if (o.status !== OrderStatus.DELIVERED) {
        throw new Error(`${o.code} isn't ready to bill yet (it's ${o.status.toLowerCase()}).`);
      }
      if (!isImmediateChannel(o.channel)) {
        throw new Error(`${o.code} isn't an in-house order.`);
      }
      if (o.customer.id !== customerId) {
        throw new Error("All orders on one bill must belong to the same customer.");
      }
    }

    const allItems = orders.flatMap((o) => o.items);
    const summary = summarise({
      lines: allItems.map((it) => ({
        quantity: it.portions.toString(),
        unitPrice: it.unitPrice.toString(),
        discountPct: it.discountPct.toString(),
        gstRatePct: it.gstRatePct.toString(),
      })),
      supplierStateCode: indefineStateCode(),
      placeOfSupplyStateCode: pos,
    });

    const invoiceNo = await nextCustomerInvoiceNumber(tx);
    const podTotal = orders
      .flatMap((o) => o.deliveries)
      .reduce((s, d) => s.plus(d.paymentAmount ? toDecimal(d.paymentAmount) : 0), new Decimal(0));
    const fullyPaid = podTotal.gte(summary.grandTotal);
    const partiallyPaid = podTotal.gt(0) && !fullyPaid;

    const room = orders.find((o) => o.roomNumber)?.roomNumber;
    const codes = orders.map((o) => o.code).join(", ");

    const invoice = await tx.customerInvoice.create({
      data: {
        invoiceNo,
        kind: CustomerInvoiceKind.ORDER,
        status: fullyPaid
          ? CustomerInvoiceStatus.PAID
          : partiallyPaid
            ? CustomerInvoiceStatus.PARTIAL
            : CustomerInvoiceStatus.ISSUED,
        issuedAt: new Date(),
        amountPaid: podTotal.toFixed(2),
        orderId: null, // consolidated — see notes for the source order codes
        customerId,
        placeOfSupplyStateCode: pos,
        subtotal: summary.subtotal.toString(),
        cgst: summary.cgst.toString(),
        sgst: summary.sgst.toString(),
        igst: summary.igst.toString(),
        taxTotal: summary.taxTotal.toString(),
        grandTotal: summary.grandTotal.toString(),
        eInvoiceStatus: EInvoiceStatus.NOT_REQUIRED,
        createdById: session.user.id,
        shareToken: newShareToken(),
        notes: `In-house bill${room ? ` · Room ${room}` : ""} · Orders: ${codes}`,
        lines: {
          create: allItems.map((it, idx) => ({
            sortOrder: idx,
            description: it.dish.name,
            hsnSac: it.dish.hsnSac ?? null,
            quantity: it.portions.toString(),
            unit: it.dish.unit,
            unitPrice: it.unitPrice.toString(),
            discountPct: it.discountPct.toString(),
            gstRatePct: it.gstRatePct.toString(),
            lineSubtotal: it.lineSubtotal.toString(),
            lineTax: it.lineTax.toString(),
            lineTotal: it.lineTotal.toString(),
          })),
        },
      },
    });

    for (const o of orders) {
      for (const d of o.deliveries) {
        if (!d.paymentAmount || !d.paymentMethod) continue;
        await tx.customerInvoicePayment.create({
          data: {
            invoiceId: invoice.id,
            amount: d.paymentAmount,
            paidAt: new Date(),
            method: d.paymentMethod as PaymentMethod,
            reference: d.paymentReference,
            notes: "Collected at delivery",
            recordedById: session.user.id,
          },
        });
      }
    }

    await tx.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { status: fullyPaid ? OrderStatus.PAID : OrderStatus.INVOICED },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_CREATED_INHOUSE",
        entity: "CustomerInvoice",
        entityId: invoice.id,
        payloadHash: sha256Json({ orderIds, invoiceNo, grandTotal: summary.grandTotal.toString() }),
      },
    });

    return invoice;
  });

  revalidatePath("/invoices");
  revalidatePath("/invoices/room-service");
  return { id: result.id, invoiceNo: result.invoiceNo };
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
