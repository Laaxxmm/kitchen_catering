import { randomBytes } from "node:crypto";
import {
  CustomerInvoiceKind,
  CustomerInvoiceStatus,
  EInvoiceStatus,
  OrderChannel,
} from "@prisma/client";
import { db } from "@/server/db";
import { isPackagePricedChannel } from "@/lib/order-channels";
import { nextCustomerInvoiceNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { summarise } from "@/lib/gst";
import { indefineStateCode } from "@/lib/org";
import { ActionError, actionFailure, type ActionResult } from "@/server/action-result";
import { buildInvoiceEmail, sendEmail } from "@/lib/email";
import { formatIST } from "@/lib/time";

// Non-"use server" internals shared by the invoice actions. Nothing here is
// a client endpoint. The public gated wrapper (createProformaInvoiceForOrder
// in actions/customer-invoices.ts) enforces requireRole; the server-internal
// chef-approval flow calls createProformaInvoiceForOrderCore directly because
// it runs post-commit under a KITCHEN_HEAD session that isn't in WRITE_ROLES
// (AUDIT_REPORT M4).

export function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Package-priced channels (banquet / buffet / ODC / packet) are billed as
 * ONE line at the agreed package total — the dishes are sub-heads with no
 * per-plate rates, so summing OrderItem prices under-bills (seen live:
 * a ₹25,000 banquet invoiced at ₹10,395). The package total is treated as
 * the pre-GST taxable value with 5% catering GST on top.
 */
export function packageSummaryLine(order: {
  channel: OrderChannel;
  headcount: number;
  contractValue: { toString(): string };
}) {
  return {
    calc: [{
      quantity: "1",
      unitPrice: order.contractValue.toString(),
      discountPct: "0",
      gstRatePct: "5",
    }],
    describe: `${order.channel} catering package — ${order.headcount} pax`,
  };
}

/**
 * Auto-creates a PROFORMA invoice when an order reaches CHEF_APPROVED /
 * CHEF_REQUISITION_PENDING. Idempotent on (orderId, kind=PROFORMA). After
 * creating, attempts to email it to the customer (best-effort; failures
 * are logged but don't throw, so the order workflow isn't held up by
 * SMTP issues).
 *
 * Called from inside the chef-approval server actions (post-commit) — the
 * role gate lives on the exported createProformaInvoiceForOrder wrapper.
 */
export async function createProformaInvoiceForOrderCore(orderId: string) {
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
    const isPackage = isPackagePricedChannel(order.channel);
    const pkg = isPackage ? packageSummaryLine(order) : null;
    const summary = summarise({
      lines: pkg
        ? pkg.calc
        : order.items.map((it) => ({
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
          finalHeadcount: order.headcount,
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
              : order.items.map((it, idx) => ({
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
        kind: fullInvoice.kind,
        issuedAt: fullInvoice.issuedAt,
        dueAt: fullInvoice.dueAt,
        orderCode: fullInvoice.order?.code ?? null,
        // Pax off the invoice we just wrote, not the live order — same
        // snapshot rule as every other render of this document.
        order: { headcount: fullInvoice.finalHeadcount ?? order.headcount, mealType: order.mealType },
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

/**
 * Best-effort email of a freshly-issued tax invoice. Runs post-commit so
 * SMTP latency doesn't hold the delivery confirmation transaction open.
 * On the auto-send pass failures are logged and swallowed (the invoice
 * still exists and can be re-sent manually); with `force: true` (the
 * user's explicit "Resend by email" click — kept awaited, the button
 * exists to send the email) failures come back as `{ ok: false }`.
 *
 * The exported emailTaxInvoice action gates this with requireRole; the
 * mobile confirm-otp route (which runs under a driver JWT, not a NextAuth
 * session) calls this core directly — best-effort auto-send (AUDIT_REPORT M5).
 */
export async function emailTaxInvoiceCore(
  invoiceId: string,
  opts: { force?: boolean } = {},
): Promise<ActionResult> {
  try {
    const invoice = await db.customerInvoice.findUnique({
      where: { id: invoiceId },
      include: { customer: true, order: { select: { eventDate: true } } },
    });
    if (!invoice) {
      if (opts.force) return { ok: false, error: "Invoice not found" };
      return { ok: true };
    }
    if (!invoice.customer.email) {
      // No email on file — surface this if it was a manual click. The
      // user is responsible for handling missing-email customers.
      if (opts.force) {
        throw new ActionError("Customer has no email on file. Add one on the customer page first.");
      }
      return { ok: true };
    }
    // A held invoice must not reach the customer. Manual click gets a
    // refusal; the auto-send pass skips quietly (best-effort contract).
    if (invoice.onHoldAt) {
      if (opts.force) {
        throw new ActionError(
          `Invoice is on hold: ${invoice.onHoldReason ?? "no reason recorded"} — release the hold first`,
        );
      }
      return { ok: true };
    }
    // Silent skip when called as the auto-send pass; force=true means
    // the user clicked "Resend by email" deliberately.
    if (invoice.emailedAt && !opts.force) return { ok: true };

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
    return { ok: true };
  } catch (err) {
    console.error(
      `[emailTaxInvoice ${invoiceId}] failed: ${err instanceof Error ? err.message : err}`,
    );
    // Surface the failure on force so the UI can show it (e.g. no email
    // on file); the auto-send pass stays best-effort and swallows it.
    if (opts.force) return actionFailure(err);
    return { ok: true };
  }
}
