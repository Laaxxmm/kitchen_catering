"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import {
  CustomerInvoiceKind,
  CustomerInvoiceStatus,
  EInvoiceStatus,
  NotificationKind,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  Role,
} from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import { deferAfterResponse } from "@/server/defer";
import { isImmediateChannel, isPackagePricedChannel } from "@/lib/order-channels";
import { nextCustomerInvoiceNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { computeLine, summarise } from "@/lib/gst";
import { STATUS_LABEL, humanizeStatus } from "@/lib/order-status";
import { toDecimal } from "@/lib/money";
import { EXCLUDE_PROFORMA } from "@/lib/invoice-kinds";
import { indefineGstin, indefineCompanyName, indefineStateCode } from "@/lib/org";
import { eInvoiceEnabled, getEInvoiceProvider } from "@/server/services/e-invoice/provider";
import { notifyRoles } from "@/server/notification-core";
import {
  newShareToken,
  packageSummaryLine,
  createProformaInvoiceForOrderCore,
  emailTaxInvoiceCore,
} from "@/server/customer-invoices-core";
import type { Prisma } from "@prisma/client";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];
// F&B Service (DELIVERY / retired alias FNB_SERVICE) can view generated
// bills — the middleware admits them to /invoices/[id] for room-service
// billing, so the read gate must match or the page crashes for them.
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.ACCOUNTS, Role.KITCHEN_HEAD, Role.STORE_KEEPER,
  Role.DELIVERY, Role.FNB_SERVICE,
];

/**
 * Create a DRAFT customer invoice from a DELIVERED order. Copies line items
 * one-to-one from the order, computes GST split (CGST+SGST if supplier state
 * == buyer state, else IGST), and snapshots totals.
 *
 * e-invoicing fields stay NOT_REQUIRED until Phase 3 wires the GSP.
 * (newShareToken / packageSummaryLine now live in customer-invoices-core.)
 */
export async function createCustomerInvoiceFromOrder(
  orderId: string,
): Promise<ActionResultWith<{ id: string; invoiceNo: string }>> {
  try {
    return await createCustomerInvoiceFromOrderInner(orderId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createCustomerInvoiceFromOrderInner(
  orderId: string,
): Promise<{ ok: true; id: string; invoiceNo: string }> {
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
    if (!order) throw new ActionError("Order not found");
    if (order.status !== OrderStatus.DELIVERED) {
      throw new ActionError(`Cannot invoice an order that's ${STATUS_LABEL[order.status].toLowerCase()}`);
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
      throw new ActionError(`${order.code} already has invoice ${existing.invoiceNo} — cancel it first to re-invoice.`);
    }

    const supplierState = indefineStateCode();
    const isPackage = isPackagePricedChannel(order.channel);
    const pkg = isPackage ? packageSummaryLine(order) : null;
    const lines = pkg
      ? pkg.calc
      : order.items.map((it) => ({
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

    // Advance the order DELIVERED → INVOICED (or straight to COMPLETED if
    // fully settled at the door) BEFORE creating the invoice, as a guarded
    // updateMany. On a double-click the second request matches zero rows and
    // bails — no second ISSUED invoice for the same order (AUDIT_REPORT M8).
    const flipped = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.DELIVERED },
      data: { status: fullyPaidAtDelivery ? OrderStatus.COMPLETED : OrderStatus.INVOICED },
    });
    if (flipped.count === 0) {
      throw new ActionError("This order was just invoiced — refresh.");
    }

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
          create: pkg
            ? [{
                sortOrder: 0,
                description: `${pkg.describe} (${order.items.map((it) => it.dish.name).join(", ")})`,
                hsnSac: null,
                quantity: "1",
                unit: "package",
                unitPrice: order.contractValue.toString(),
                discountPct: "0",
                gstRatePct: "5",
                lineSubtotal: summary.subtotal.toString(),
                lineTax: summary.taxTotal.toString(),
                lineTotal: summary.grandTotal.toString(),
              }]
            : order.items.map((it, idx) => {
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

    // (Order status was already advanced by the guarded updateMany above.)

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
  return { ok: true, id: result.id, invoiceNo: result.invoiceNo };
}

// ─── Proforma invoice (workflow v2) ─────────────────────────────────────

/**
 * Gated wrapper for the proforma auto-create + email flow. The exported
 * server action enforces requireRole(WRITE_ROLES) so it can't be invoked
 * as an endpoint by arbitrary signed-in users (AUDIT_REPORT M4). The
 * server-internal chef-approval flow calls createProformaInvoiceForOrderCore
 * directly (post-commit, under a KITCHEN_HEAD session).
 */
export async function createProformaInvoiceForOrder(orderId: string) {
  await requireRole(WRITE_ROLES);
  return createProformaInvoiceForOrderCore(orderId);
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

export async function createStandaloneCustomerInvoice(
  raw: StandaloneInvoiceInput,
): Promise<ActionResultWith<{ id: string; invoiceNo: string }>> {
  try {
    return await createStandaloneCustomerInvoiceInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createStandaloneCustomerInvoiceInner(
  raw: StandaloneInvoiceInput,
): Promise<{ ok: true; id: string; invoiceNo: string }> {
  const session = await requireRole(WRITE_ROLES);
  if (!raw.customerId) throw new ActionError("Customer is required");
  if (!raw.lines || raw.lines.length === 0) throw new ActionError("Add at least one line");

  const result = await db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: raw.customerId },
      select: { id: true },
    });
    if (!customer) throw new ActionError("Customer not found");

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
            const { subtotal, tax, total } = computeLine({
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct ?? "0",
              gstRatePct: l.gstRatePct ?? "0",
            });
            return {
              sortOrder: idx,
              description: l.description,
              hsnSac: l.hsnSac ?? null,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct ?? "0",
              gstRatePct: l.gstRatePct ?? "0",
              lineSubtotal: subtotal.toString(),
              lineTax: tax.toString(),
              lineTotal: total.toString(),
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
  return { ok: true, id: result.id, invoiceNo: result.invoiceNo };
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

export async function updateDraftInvoice(id: string, input: EditInvoiceInput): Promise<ActionResult> {
  try {
    return await updateDraftInvoiceInner(id, input);
  } catch (err) {
    return actionFailure(err);
  }
}

async function updateDraftInvoiceInner(id: string, input: EditInvoiceInput): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  if (!input.lines || input.lines.length === 0) throw new ActionError("Add at least one line");

  await db.$transaction(async (tx) => {
    const inv = await tx.customerInvoice.findUnique({
      where: { id },
      select: { id: true, status: true, placeOfSupplyStateCode: true },
    });
    if (!inv) throw new ActionError("Invoice not found");
    if (inv.status !== CustomerInvoiceStatus.DRAFT) {
      throw new ActionError("Only DRAFT invoices can be edited. Cancel and re-create to amend a non-draft.");
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
        const { subtotal, tax, total } = computeLine({
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct ?? "0",
          gstRatePct: l.gstRatePct ?? "0",
        });
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
          lineSubtotal: subtotal.toString(),
          lineTax: tax.toString(),
          lineTotal: total.toString(),
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
  return { ok: true };
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
 * On the auto-send pass failures are logged and swallowed (the invoice
 * still exists and can be re-sent manually); with `force: true` (the
 * user's explicit "Resend by email" click — kept awaited, the button
 * exists to send the email) failures come back as `{ ok: false }`.
 */
export async function emailTaxInvoice(
  invoiceId: string,
  opts: { force?: boolean } = {},
): Promise<ActionResult> {
  // Gate the endpoint so arbitrary signed-in users can't (re)send invoice
  // emails / stamp emailedAt (AUDIT_REPORT M5). The mobile confirm-otp route
  // calls emailTaxInvoiceCore directly (driver JWT, no NextAuth session).
  try {
    await requireRole(WRITE_ROLES);
  } catch (err) {
    return actionFailure(err);
  }
  return emailTaxInvoiceCore(invoiceId, opts);
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
export async function markCustomerInvoicePaid(input: MarkPaidInput): Promise<ActionResult> {
  try {
    return await markCustomerInvoicePaidInner(input);
  } catch (err) {
    return actionFailure(err);
  }
}

async function markCustomerInvoicePaidInner(input: MarkPaidInput): Promise<{ ok: true }> {
  // Tighter gate than the rest of the WRITE_ROLES set — admin / manager
  // only. Accounts records detailed payments through the RecordPayment
  // form; this one-click action belongs to the people who can also
  // approve orders.
  const session = await requireRole([Role.ADMIN, Role.MANAGER]);
  const { invoiceId } = input;
  const paidAtDate = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAtDate.getTime())) {
    throw new ActionError("paidAt is not a valid date");
  }
  await db.$transaction(async (tx) => {
    const invoice = await tx.customerInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true, status: true, grandTotal: true, amountPaid: true, orderId: true,
        onHoldAt: true, onHoldReason: true,
      },
    });
    if (!invoice) throw new ActionError("Invoice not found");
    // Billing hold blocks every payment path, one-click included —
    // otherwise "Mark paid" would be a hold bypass.
    if (invoice.onHoldAt) {
      throw new ActionError(
        `Invoice is on hold: ${invoice.onHoldReason ?? "no reason recorded"} — release the hold first`,
      );
    }
    if (invoice.status === CustomerInvoiceStatus.PAID) {
      throw new ActionError("Invoice is already marked paid");
    }
    if (invoice.status === CustomerInvoiceStatus.CANCELLED) {
      throw new ActionError("Cannot mark a cancelled invoice paid");
    }
    if (invoice.status === CustomerInvoiceStatus.DRAFT) {
      throw new ActionError("Issue the invoice first, then mark it paid");
    }
    const balance = new Decimal(invoice.grandTotal.toString()).minus(invoice.amountPaid.toString());
    // H3: flip the status FIRST via a guarded update (only ISSUED/PARTIAL are
    // eligible) so a double-click can't create two full-balance payment rows —
    // the loser matches zero rows and aborts. amountPaid is settled here too
    // when there's a balance; the numeric-edge case (balance ≤ 0) only flips.
    const flipped = await tx.customerInvoice.updateMany({
      where: {
        id: invoiceId,
        status: { in: [CustomerInvoiceStatus.ISSUED, CustomerInvoiceStatus.PARTIAL] },
      },
      data: {
        status: CustomerInvoiceStatus.PAID,
        ...(balance.gt(0) ? { amountPaid: invoice.grandTotal.toString() } : {}),
      },
    });
    if (flipped.count === 0) {
      throw new ActionError("Already marked paid — refresh the page.");
    }
    if (balance.gt(0)) {
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
    }
    // If the invoice belongs to an order, close it — the commercial
    // transaction is complete. COMPLETED is the terminal order state.
    // (Wave 1 behaviour — preserved exactly.)
    if (invoice.orderId) {
      await tx.order.update({
        where: { id: invoice.orderId },
        data: { status: OrderStatus.COMPLETED },
      });
    } else {
      // H5: consolidated folio invoice (orderId: null) — full settlement
      // closes every member order it billed. Guarded INVOICED → COMPLETED.
      await tx.order.updateMany({
        where: { consolidatedInvoiceId: invoiceId, status: OrderStatus.INVOICED },
        data: { status: OrderStatus.COMPLETED },
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

  // Post-commit fan-out — best-effort, don't hold the button for it.
  deferAfterResponse("invoice-paid:notify", async () => {
    const invoiceAfter = await db.customerInvoice.findUnique({
      where: { id: invoiceId },
      select: { invoiceNo: true, customer: { select: { name: true } } },
    });
    if (!invoiceAfter) return;
    await notifyRoles([Role.SALES, Role.ACCOUNTS, Role.ADMIN, Role.MANAGER], {
      kind: "CUSTOMER_INVOICE_PAID",
      title: `Invoice ${invoiceAfter.invoiceNo} paid`,
      body: `${invoiceAfter.customer.name} cleared the balance.`,
      link: `/invoices/${invoiceId}`,
      dedupeKey: `customer-invoice-paid:${invoiceId}`,
    });
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/payments/receivables");
  return { ok: true };
}

export async function issueCustomerInvoice(id: string): Promise<ActionResult> {
  try {
    return await issueCustomerInvoiceInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function issueCustomerInvoiceInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const wantsEInvoice = await eInvoiceEnabled();

  await db.$transaction(async (tx) => {
    const invoice = await tx.customerInvoice.findUnique({
      where: { id },
      select: { status: true, orderId: true, onHoldAt: true, onHoldReason: true },
    });
    if (!invoice) throw new ActionError("Invoice not found");
    if (invoice.onHoldAt) {
      throw new ActionError(
        `Invoice is on hold: ${invoice.onHoldReason ?? "no reason recorded"} — release the hold first`,
      );
    }
    if (invoice.status !== CustomerInvoiceStatus.DRAFT) {
      throw new ActionError(`Cannot issue an invoice that's ${humanizeStatus(invoice.status)}`);
    }
    // Status guard: a concurrent issue loses the race cleanly.
    const updated = await tx.customerInvoice.updateMany({
      where: { id, status: CustomerInvoiceStatus.DRAFT },
      data: {
        status: CustomerInvoiceStatus.ISSUED,
        issuedAt: new Date(),
        eInvoiceStatus: wantsEInvoice ? EInvoiceStatus.PENDING : EInvoiceStatus.NOT_REQUIRED,
      },
    });
    if (updated.count === 0) {
      throw new ActionError("This invoice was already issued — refresh the page.");
    }
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

  // Post-commit: kick off IRN generation after the response is sent, like
  // every other post-commit side effect (emails, notifications).
  if (wantsEInvoice) {
    deferAfterResponse("invoice-irn", () => generateIRNForInvoice(id));
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  return { ok: true };
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

export async function cancelCustomerInvoiceEInvoice(
  invoiceId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    return await cancelCustomerInvoiceEInvoiceInner(invoiceId, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function cancelCustomerInvoiceEInvoiceInner(
  invoiceId: string,
  reason: string,
): Promise<{ ok: true }> {
  const session = await requireRole([Role.ADMIN, Role.ACCOUNTS]);
  if (!reason.trim()) throw new ActionError("Reason required");

  const invoice = await db.customerInvoice.findUnique({
    where: { id: invoiceId },
    select: { eInvoiceStatus: true, irn: true, ackDate: true },
  });
  if (!invoice) throw new ActionError("Invoice not found");
  if (invoice.eInvoiceStatus !== EInvoiceStatus.GENERATED || !invoice.irn) {
    throw new ActionError("Invoice does not have a GENERATED IRN to cancel");
  }
  const hoursSinceAck = invoice.ackDate
    ? (Date.now() - invoice.ackDate.getTime()) / (60 * 60 * 1000)
    : 999;
  if (hoursSinceAck > 24) {
    throw new ActionError("IRN can only be cancelled within 24 hours of issue. Issue a credit note instead.");
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
  return { ok: true };
}

export async function cancelCustomerInvoice(id: string, reason: string): Promise<ActionResult> {
  try {
    const session = await requireRole([Role.ADMIN, Role.MANAGER]);
    if (!reason.trim()) throw new ActionError("Reason required");
    let revertedOrderId: string | null = null;
    await db.$transaction(async (tx) => {
      const invoice = await tx.customerInvoice.findUnique({
        where: { id },
        select: { status: true, kind: true, orderId: true, eInvoiceStatus: true },
      });
      if (!invoice) throw new ActionError("Invoice not found");
      if (invoice.status === CustomerInvoiceStatus.CANCELLED) {
        throw new ActionError("This invoice is already cancelled.");
      }
      // Money has landed against this invoice — cancelling would strand those
      // payments (and a PAID order would point at a cancelled invoice).
      // Reverse the payments first, which demotes the invoice to ISSUED.
      if (
        invoice.status === CustomerInvoiceStatus.PAID ||
        invoice.status === CustomerInvoiceStatus.PARTIAL
      ) {
        throw new ActionError("Payments are recorded against this invoice — reverse them first.");
      }
      // A live e-invoice (IRN) must be cancelled with the GSP first, or the
      // books and the IRP disagree. Mirrors cancelCustomerInvoiceEInvoice.
      if (invoice.eInvoiceStatus === EInvoiceStatus.GENERATED) {
        throw new ActionError(
          "This invoice has a live e-invoice (IRN) — cancel the e-invoice first, then cancel the invoice.",
        );
      }

      // Status guard: a concurrent payment/issue loses the race cleanly.
      const cancelled = await tx.customerInvoice.updateMany({
        where: {
          id,
          status: {
            notIn: [
              CustomerInvoiceStatus.CANCELLED,
              CustomerInvoiceStatus.PAID,
              CustomerInvoiceStatus.PARTIAL,
            ],
          },
        },
        data: { status: CustomerInvoiceStatus.CANCELLED },
      });
      if (cancelled.count === 0) {
        throw new ActionError("This invoice just changed — refresh the page.");
      }

      // Re-invoicing needs the order back at DELIVERED (the "generate invoice"
      // button only renders there), so revert it — this makes the duplicate-
      // invoice advice "cancel it first to re-invoice" actually work. Guarded
      // to only an INVOICED order so nothing further along is disturbed.
      if (invoice.kind === CustomerInvoiceKind.ORDER && invoice.orderId) {
        const reverted = await tx.order.updateMany({
          where: { id: invoice.orderId, status: OrderStatus.INVOICED },
          data: { status: OrderStatus.DELIVERED },
        });
        if (reverted.count > 0) revertedOrderId = invoice.orderId;
      } else if (invoice.orderId === null) {
        // H5: consolidated folio invoice — send every member order back to
        // DELIVERED and clear the back-link so they can be re-billed. (Only
        // ISSUED folios reach here; a paid/partial one is blocked above.)
        await tx.order.updateMany({
          where: { consolidatedInvoiceId: id, status: OrderStatus.INVOICED },
          data: { status: OrderStatus.DELIVERED, consolidatedInvoiceId: null },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "CUSTOMER_INVOICE_CANCELLED",
          entity: "CustomerInvoice",
          entityId: id,
          payloadHash: sha256Json({ reason, revertedOrderToDelivered: revertedOrderId !== null }),
        },
      });
    });
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    if (revertedOrderId) revalidatePath(`/orders/${revertedOrderId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Billing hold ────────────────────────────────────────────────────────

/**
 * Put an invoice on billing hold — wrong address, wrong client, wrong
 * items or a payment dispute. While held the invoice can't take payments,
 * be issued, or be emailed to the customer until the hold is released.
 * PAID and CANCELLED invoices can't be held; neither can an already-held
 * one.
 */
export async function holdCustomerInvoice(id: string, reason: string): Promise<ActionResult> {
  try {
    return await holdCustomerInvoiceInner(id, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function holdCustomerInvoiceInner(id: string, reason: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const trimmed = reason?.trim();
  if (!trimmed) {
    throw new ActionError(
      "Reason required — e.g. wrong address, wrong client, wrong items, payment dispute.",
    );
  }

  const heldAt = new Date();
  await db.$transaction(async (tx) => {
    const invoice = await tx.customerInvoice.findUnique({
      where: { id },
      select: { status: true, onHoldAt: true },
    });
    if (!invoice) throw new ActionError("Invoice not found");
    if (invoice.onHoldAt) throw new ActionError("Invoice is already on hold");
    if (invoice.status === CustomerInvoiceStatus.CANCELLED) {
      throw new ActionError("Cannot hold a cancelled invoice");
    }
    if (invoice.status === CustomerInvoiceStatus.PAID) {
      throw new ActionError("Invoice is already fully paid — nothing to hold");
    }
    // State guard: two people acting at once (or a payment landing mid-
    // click) — the loser matches zero rows and gets a clear message.
    const updated = await tx.customerInvoice.updateMany({
      where: {
        id,
        onHoldAt: null,
        status: { notIn: [CustomerInvoiceStatus.CANCELLED, CustomerInvoiceStatus.PAID] },
      },
      data: { onHoldAt: heldAt, onHoldReason: trimmed, onHoldById: session.user.id },
    });
    if (updated.count === 0) {
      throw new ActionError("This invoice just changed — refresh the page.");
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_HELD",
        entity: "CustomerInvoice",
        entityId: id,
        payloadHash: sha256Json({ reason: trimmed }),
      },
    });
  });

  // Fan-out to the finance/management desks after the response — the
  // holder's button shouldn't wait on N notification inserts.
  deferAfterResponse("invoice-hold:notify", async () => {
    const invoice = await db.customerInvoice.findUnique({
      where: { id },
      select: { invoiceNo: true, customer: { select: { name: true } } },
    });
    if (!invoice) return;
    await notifyRoles([Role.ACCOUNTS, Role.MANAGER, Role.ADMIN], {
      kind: NotificationKind.GENERIC,
      title: `Invoice ${invoice.invoiceNo} put on hold`,
      body: `${invoice.customer.name} — ${trimmed}. Payments and emails are blocked until the hold is released.`,
      link: `/invoices/${id}`,
      // Timestamped so a later hold→release→hold cycle notifies again.
      dedupeKey: `customer-invoice-hold:${id}:${heldAt.getTime()}`,
    });
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  return { ok: true };
}

/** Release a billing hold. The optional note lands in the audit log. */
export async function releaseCustomerInvoiceHold(id: string, note?: string): Promise<ActionResult> {
  try {
    return await releaseCustomerInvoiceHoldInner(id, note);
  } catch (err) {
    return actionFailure(err);
  }
}

async function releaseCustomerInvoiceHoldInner(id: string, note?: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    const invoice = await tx.customerInvoice.findUnique({
      where: { id },
      select: { onHoldAt: true, onHoldReason: true },
    });
    if (!invoice) throw new ActionError("Invoice not found");
    if (!invoice.onHoldAt) throw new ActionError("Invoice is not on hold");
    // State guard: a concurrent release loses the race cleanly.
    const updated = await tx.customerInvoice.updateMany({
      where: { id, onHoldAt: { not: null } },
      data: { onHoldAt: null, onHoldReason: null, onHoldById: null },
    });
    if (updated.count === 0) {
      throw new ActionError("This hold was already released — refresh the page.");
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_HOLD_RELEASED",
        entity: "CustomerInvoice",
        entityId: id,
        payloadHash: sha256Json({
          heldReason: invoice.onHoldReason,
          note: note?.trim() || null,
        }),
      },
    });
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  return { ok: true };
}

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listCustomerInvoices(
  opts: { status?: CustomerInvoiceStatus[]; customerId?: string; excludeProforma?: boolean } = {},
) {
  await requireRole(READ_ROLES);
  return db.customerInvoice.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      // Collect/receivable views pass this so proformas don't show as owed.
      ...(opts.excludeProforma ? EXCLUDE_PROFORMA : {}),
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
 * Billing history for one customer, optionally filtered to a date range.
 * Filters on the commercial date — issuedAt when the invoice was issued,
 * falling back to createdAt for never-issued drafts. `from`/`to` arrive as
 * yyyy-MM-dd strings from <input type="date">; `to` is inclusive (we filter
 * strictly-before the following midnight). Invalid dates are ignored.
 */
export async function listCustomerInvoicesForCustomer(
  customerId: string,
  opts: { from?: string; to?: string } = {},
) {
  // Same read desk as the other receivables lists — finance + management
  // + the sales team who own the customer relationship.
  await requireRole([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.SALES]);
  const fromRaw = opts.from ? new Date(opts.from) : null;
  const toRaw = opts.to ? new Date(opts.to) : null;
  const from = fromRaw && !Number.isNaN(fromRaw.getTime()) ? fromRaw : null;
  const toEnd =
    toRaw && !Number.isNaN(toRaw.getTime())
      ? new Date(toRaw.getTime() + 24 * 60 * 60 * 1000)
      : null;
  const range = {
    ...(from ? { gte: from } : {}),
    ...(toEnd ? { lt: toEnd } : {}),
  };
  return db.customerInvoice.findMany({
    where: {
      customerId,
      ...(from || toEnd
        ? { OR: [{ issuedAt: range }, { issuedAt: null, createdAt: range }] }
        : {}),
    },
    select: {
      id: true,
      invoiceNo: true,
      kind: true,
      status: true,
      issuedAt: true,
      createdAt: true,
      grandTotal: true,
      amountPaid: true,
      onHoldAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
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
export async function createConsolidatedInHouseInvoice(
  orderIds: string[],
): Promise<ActionResultWith<{ id: string; invoiceNo: string }>> {
  try {
    return await createConsolidatedInHouseInvoiceInner(orderIds);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createConsolidatedInHouseInvoiceInner(
  orderIds: string[],
): Promise<{ ok: true; id: string; invoiceNo: string }> {
  const session = await requireRole(INHOUSE_BILL_ROLES);
  if (!orderIds || orderIds.length === 0) {
    throw new ActionError("Pick at least one order to bill.");
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
    if (orders.length === 0) throw new ActionError("Orders not found.");

    const customerId = orders[0].customer.id;
    const pos = orders[0].placeOfSupplyStateCode;
    for (const o of orders) {
      if (o.status !== OrderStatus.DELIVERED) {
        throw new ActionError(`${o.code} isn't ready to bill yet (it's ${STATUS_LABEL[o.status].toLowerCase()}).`);
      }
      if (!isImmediateChannel(o.channel)) {
        throw new ActionError(`${o.code} isn't an in-house order.`);
      }
      if (o.customer.id !== customerId) {
        throw new ActionError("All orders on one bill must belong to the same customer.");
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

    // H5 + M9: advance the members guarded on status DELIVERED (else an
    // overlapping submission could double-bill) and back-link each to this
    // consolidated invoice so pay/cancel/reverse can find them (the invoice
    // itself stores orderId: null). Count must equal the orders we validated.
    const advanced = await tx.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) }, status: OrderStatus.DELIVERED },
      data: {
        status: fullyPaid ? OrderStatus.COMPLETED : OrderStatus.INVOICED,
        consolidatedInvoiceId: invoice.id,
      },
    });
    if (advanced.count !== orders.length) {
      throw new ActionError("One of these orders was just billed elsewhere — refresh and try again.");
    }

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
  return { ok: true, id: result.id, invoiceNo: result.invoiceNo };
}

export async function getCustomerInvoice(id: string) {
  // Same read desk as listCustomerInvoices — invoice PDFs carry amounts,
  // GSTIN and address, so this is role-gated (not just session-gated). The
  // /api/invoices/[id]/pdf route has no middleware rule of its own and
  // relies on this gate (AUDIT_REPORT M6). READ_ROLES includes SALES so the
  // "invoice paid" notification link resolves for them (M15).
  await requireRole(READ_ROLES);
  return db.customerInvoice.findUnique({
    where: { id },
    include: {
      customer: true,
      order: { select: { id: true, code: true } },
      createdBy: { select: { name: true } },
      onHoldBy: { select: { name: true } },
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
