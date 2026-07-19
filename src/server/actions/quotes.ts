"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  OrderStatus,
  QuoteEventKind,
  QuoteStatus,
  Role,
} from "@prisma/client";
import { db } from "@/server/db";
import { requireRole, requireSession } from "@/server/rbac";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import { QuoteCreateInput, QuoteLineInput } from "@/lib/validators";
import { nextOrderCode, nextQuoteNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { summarise } from "@/lib/gst";
import { humanizeStatus } from "@/lib/order-status";
import { indefineStateCode } from "@/lib/org";
import { toDecimal, formatINR } from "@/lib/money";
import { buildQuoteEmail, sendEmail } from "@/lib/email";
import { formatIST } from "@/lib/time";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.SALES];
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.ACCOUNTS, Role.KITCHEN_HEAD,
];

function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

// ─── Create ─────────────────────────────────────────────────────────────

/**
 * Create a quote in DRAFT. Numbers it from QuoteNumberSequence so the
 * customer-facing quoteNo (e.g. QT-26-27-0001) stays gap-free.
 *
 * Totals are computed via the same `summarise()` helper used by orders
 * and invoices — same GST math, same Indian rounding rule.
 */
export async function createQuote(raw: unknown): Promise<ActionResultWith<{ id: string; quoteNo: string }>> {
  try {
    return await createQuoteInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createQuoteInner(raw: unknown): Promise<{ ok: true; id: string; quoteNo: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = QuoteCreateInput.parse(raw);

  const supplierState = indefineStateCode();
  const summary = summarise({
    lines: input.lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct ?? "0",
      gstRatePct: l.gstRatePct ?? "0",
    })),
    supplierStateCode: supplierState,
    placeOfSupplyStateCode: input.header.placeOfSupplyStateCode,
  });

  const result = await db.$transaction(async (tx) => {
    const quoteNo = await nextQuoteNumber(tx);
    const quote = await tx.quote.create({
      data: {
        quoteNo,
        customerId: input.header.customerId,
        title: input.header.title,
        eventDate: input.header.eventDate ? new Date(input.header.eventDate) : null,
        headcount: input.header.headcount ?? null,
        mealType: input.header.mealType ?? null,
        deliveryAddress: input.header.deliveryAddress ?? null,
        placeOfSupplyStateCode: input.header.placeOfSupplyStateCode,
        validUntil: input.header.validUntil ? new Date(input.header.validUntil) : null,
        notes: input.header.notes ?? null,
        termsMd: input.header.termsMd ?? null,
        status: QuoteStatus.DRAFT,
        version: 1,
        subtotal: summary.subtotal.toString(),
        taxTotal: summary.taxTotal.toString(),
        grandTotal: summary.grandTotal.toString(),
        createdById: session.user.id,
        shareToken: newShareToken(),
        lines: {
          create: input.lines.map((l, idx) => {
            const qty = toDecimal(l.quantity);
            const price = toDecimal(l.unitPrice);
            const discount = toDecimal(l.discountPct ?? "0").div(100);
            const gst = toDecimal(l.gstRatePct ?? "0").div(100);
            const sub = qty.times(price).times(new Decimal(1).minus(discount));
            const tax = sub.times(gst);
            return {
              sortOrder: idx,
              dishId: l.dishId ?? null,
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
        action: "QUOTE_CREATED",
        entity: "Quote",
        entityId: quote.id,
        payloadHash: sha256Json({ quoteNo, customerId: input.header.customerId, grandTotal: summary.grandTotal.toString() }),
      },
    });
    return quote;
  });

  revalidatePath("/quotes");
  return { ok: true, id: result.id, quoteNo: result.quoteNo };
}

// ─── Status transitions ─────────────────────────────────────────────────

/**
 * Mark a DRAFT/REVISED quote as SENT and email it to the customer if
 * they have an email on file. Email is best-effort — failures don't
 * block the status transition, they just leave a "no email on file"
 * note on the quote event timeline.
 *
 * Stamps `sentAt` and writes a QuoteEvent on every send.
 */
export async function sendQuote(id: string): Promise<ActionResult> {
  try {
    return await sendQuoteInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function sendQuoteInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const ctx = await db.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id }, select: { status: true, lines: true } });
    if (!q) throw new ActionError("Quote not found");
    if (q.status !== QuoteStatus.DRAFT && q.status !== QuoteStatus.REVISED) {
      throw new ActionError(`Only draft or revised quotes can be sent (current: ${humanizeStatus(q.status)})`);
    }
    if (q.lines.length === 0) throw new ActionError("Add at least one line before sending");
    // Status guard in the WHERE clause: a concurrent double-send loses the
    // race and gets a clear message instead of double-transitioning.
    const updated = await tx.quote.updateMany({
      where: { id, status: { in: [QuoteStatus.DRAFT, QuoteStatus.REVISED] } },
      data: { status: QuoteStatus.SENT, sentAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ActionError("This quote was already sent — refresh the page.");
    }
    await tx.quoteEvent.create({
      data: {
        quoteId: id,
        kind: QuoteEventKind.SENT,
        toStatus: QuoteStatus.SENT,
        actorUserId: session.user.id,
      },
    });
    await tx.auditLog.create({
      data: { userId: session.user.id, action: "QUOTE_SENT", entity: "Quote", entityId: id },
    });
    return { sessionUserId: session.user.id };
  });

  // Post-commit: best-effort email to the customer with the share link.
  // Kept awaited — this button exists to send the email, and the quote
  // timeline note it writes must be visible when the page revalidates.
  await emailQuoteToCustomerInternal(id, ctx.sessionUserId, "first-send");

  revalidatePath(`/quotes/${id}`);
  revalidatePath("/quotes");
  return { ok: true };
}

/**
 * Resend the quote email — used when the customer says "I never got
 * your email" or when a revision is issued. Doesn't change the quote's
 * status; just shoots another email and logs an event in the timeline.
 */
export async function resendQuoteEmail(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    const quote = await db.quote.findUnique({
      where: { id },
      select: { status: true, customer: { select: { email: true } } },
    });
    if (!quote) throw new ActionError("Quote not found");
    if (quote.status === QuoteStatus.DRAFT) {
      throw new ActionError("Draft quotes cannot be emailed yet — hit 'Send to customer' first");
    }
    if (!quote.customer.email) {
      throw new ActionError("Customer has no email on file. Add one on the customer page first.");
    }
    await emailQuoteToCustomerInternal(id, session.user.id, "resend");
    revalidatePath(`/quotes/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Shared email-sending core. Renders the email body, attempts delivery,
 * and writes a QuoteEvent to the timeline so the salesperson can see
 * exactly when each send happened. Swallows SMTP errors so an outage
 * doesn't break the status transition.
 */
async function emailQuoteToCustomerInternal(
  quoteId: string,
  actorUserId: string,
  flavour: "first-send" | "resend",
): Promise<void> {
  try {
    const quote = await db.quote.findUnique({
      where: { id: quoteId },
      include: { customer: { select: { name: true, email: true } } },
    });
    if (!quote) return;
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const publicUrl = `${baseUrl}/q/${quote.shareToken}`;
    if (!quote.customer.email) {
      await db.quoteEvent.create({
        data: {
          quoteId,
          kind: QuoteEventKind.NOTE,
          note:
            flavour === "first-send"
              ? "Quote marked sent, but customer has no email on file — share the public link manually."
              : "Resend skipped — customer has no email on file.",
          actorUserId,
        },
      });
      return;
    }
    const composed = buildQuoteEmail({
      quoteNo: quote.quoteNo,
      customerName: quote.customer.name,
      title: quote.title,
      grandTotal: formatINR(quote.grandTotal),
      eventDateLabel: quote.eventDate ? formatIST(quote.eventDate, "EEE d MMM yyyy") : undefined,
      validUntilLabel: quote.validUntil ? formatIST(quote.validUntil, "EEE d MMM yyyy") : undefined,
      publicUrl,
      notes: quote.notes,
    });
    const sent = await sendEmail({
      to: quote.customer.email,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
    });
    await db.quoteEvent.create({
      data: {
        quoteId,
        kind: QuoteEventKind.NOTE,
        note:
          sent.provider === "console"
            ? `(Dev) Quote email composed for ${quote.customer.email} — provider is in console mode.`
            : flavour === "first-send"
              ? `Emailed to ${quote.customer.email}.`
              : `Re-emailed to ${quote.customer.email}.`,
        actorUserId,
      },
    });
  } catch (err) {
    console.error(
      `[emailQuoteToCustomer ${quoteId}] failed: ${err instanceof Error ? err.message : err}`,
    );
    try {
      await db.quoteEvent.create({
        data: {
          quoteId,
          kind: QuoteEventKind.NOTE,
          note: `Email send failed: ${err instanceof Error ? err.message : "unknown error"}. Share the public link manually.`,
          actorUserId,
        },
      });
    } catch {
      // ignore — we already logged to stderr.
    }
  }
}

/** Move SENT/NEGOTIATING → ACCEPTED. Recorded against the customer's behalf. */
export async function acceptQuote(id: string, note?: string): Promise<ActionResult> {
  try {
    return await acceptQuoteInner(id, note);
  } catch (err) {
    return actionFailure(err);
  }
}

const ACCEPTABLE_STATUSES: QuoteStatus[] = [
  QuoteStatus.SENT,
  QuoteStatus.NEGOTIATING,
  QuoteStatus.CHANGES_REQUESTED,
  QuoteStatus.REVISED,
];

async function acceptQuoteInner(id: string, note?: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id }, select: { status: true } });
    if (!q) throw new ActionError("Quote not found");
    if (!ACCEPTABLE_STATUSES.includes(q.status)) {
      throw new ActionError(`Cannot accept a quote that's ${humanizeStatus(q.status)}`);
    }
    // Status guard: a concurrent transition loses the race with a clear
    // message instead of double-accepting.
    const updated = await tx.quote.updateMany({
      where: { id, status: { in: ACCEPTABLE_STATUSES } },
      data: { status: QuoteStatus.ACCEPTED, acceptedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ActionError("Quote status just changed — refresh the page.");
    }
    await tx.quoteEvent.create({
      data: {
        quoteId: id,
        kind: QuoteEventKind.ACCEPTED,
        fromStatus: q.status,
        toStatus: QuoteStatus.ACCEPTED,
        actorUserId: session.user.id,
        note: note ?? null,
      },
    });
    await tx.auditLog.create({
      data: { userId: session.user.id, action: "QUOTE_ACCEPTED", entity: "Quote", entityId: id },
    });
  });
  revalidatePath(`/quotes/${id}`);
  revalidatePath("/quotes");
  return { ok: true };
}

/** Customer didn't go with us — terminal. */
export async function markQuoteLost(id: string, reason: string): Promise<ActionResult> {
  try {
    return await markQuoteLostInner(id, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function markQuoteLostInner(id: string, reason: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  if (!reason.trim()) throw new ActionError("Please record why this quote was lost");
  await db.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id }, select: { status: true } });
    if (!q) throw new ActionError("Quote not found");
    if (q.status === QuoteStatus.CONVERTED || q.status === QuoteStatus.LOST) {
      throw new ActionError(`Quote is already ${humanizeStatus(q.status)}`);
    }
    // Status guard: don't mark lost if someone converted/closed it meanwhile.
    const updated = await tx.quote.updateMany({
      where: { id, status: { notIn: [QuoteStatus.CONVERTED, QuoteStatus.LOST] } },
      data: { status: QuoteStatus.LOST },
    });
    if (updated.count === 0) {
      throw new ActionError("Quote was already closed — refresh the page.");
    }
    await tx.quoteEvent.create({
      data: {
        quoteId: id,
        kind: QuoteEventKind.REJECTED,
        fromStatus: q.status,
        toStatus: QuoteStatus.LOST,
        note: reason,
        actorUserId: session.user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "QUOTE_LOST",
        entity: "Quote",
        entityId: id,
        payloadHash: sha256Json({ reason }),
      },
    });
  });
  revalidatePath(`/quotes/${id}`);
  revalidatePath("/quotes");
  return { ok: true };
}

/**
 * Customer asked for changes. Marks the quote CHANGES_REQUESTED and
 * writes an event with the customer's note. The salesperson then edits
 * the lines and uses `reviseQuote` to issue a new version.
 */
export async function flagQuoteChangesRequested(id: string, note: string): Promise<ActionResult> {
  try {
    return await flagQuoteChangesRequestedInner(id, note);
  } catch (err) {
    return actionFailure(err);
  }
}

async function flagQuoteChangesRequestedInner(id: string, note: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  if (!note.trim()) throw new ActionError("Capture what the customer wants changed");
  await db.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id }, select: { status: true } });
    if (!q) throw new ActionError("Quote not found");
    if (q.status !== QuoteStatus.SENT && q.status !== QuoteStatus.NEGOTIATING) {
      throw new ActionError(`Cannot mark changes-requested from ${humanizeStatus(q.status)}`);
    }
    // Status guard: a concurrent transition loses the race cleanly.
    const updated = await tx.quote.updateMany({
      where: { id, status: { in: [QuoteStatus.SENT, QuoteStatus.NEGOTIATING] } },
      data: { status: QuoteStatus.CHANGES_REQUESTED },
    });
    if (updated.count === 0) {
      throw new ActionError("Quote status just changed — refresh the page.");
    }
    await tx.quoteEvent.create({
      data: {
        quoteId: id,
        kind: QuoteEventKind.CHANGES_REQUESTED,
        fromStatus: q.status,
        toStatus: QuoteStatus.CHANGES_REQUESTED,
        note,
        actorUserId: session.user.id,
      },
    });
  });
  revalidatePath(`/quotes/${id}`);
  return { ok: true };
}

// ─── Edit (DRAFT only) ───────────────────────────────────────────────────

export async function addQuoteLine(quoteId: string, raw: unknown): Promise<ActionResult> {
  try {
    return await addQuoteLineInner(quoteId, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function addQuoteLineInner(quoteId: string, raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = QuoteLineInput.parse(raw);
  await db.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({
      where: { id: quoteId },
      select: { status: true, _count: { select: { lines: true } } },
    });
    if (!q) throw new ActionError("Quote not found");
    if (q.status !== QuoteStatus.DRAFT) {
      throw new ActionError("Lines can only be added to a DRAFT quote");
    }
    const qty = toDecimal(input.quantity);
    const price = toDecimal(input.unitPrice);
    const discount = toDecimal(input.discountPct ?? "0").div(100);
    const gst = toDecimal(input.gstRatePct ?? "0").div(100);
    const sub = qty.times(price).times(new Decimal(1).minus(discount));
    const tax = sub.times(gst);
    await tx.quoteLine.create({
      data: {
        quoteId,
        sortOrder: q._count.lines,
        dishId: input.dishId ?? null,
        description: input.description,
        hsnSac: input.hsnSac ?? null,
        quantity: input.quantity,
        unit: input.unit,
        unitPrice: input.unitPrice,
        discountPct: input.discountPct ?? "0",
        gstRatePct: input.gstRatePct ?? "0",
        lineSubtotal: sub.toDecimalPlaces(2).toString(),
        lineTax: tax.toDecimalPlaces(2).toString(),
        lineTotal: sub.plus(tax).toDecimalPlaces(2).toString(),
      },
    });
    await recomputeQuoteTotals(tx, quoteId);
    await tx.auditLog.create({
      data: { userId: session.user.id, action: "QUOTE_LINE_ADDED", entity: "Quote", entityId: quoteId },
    });
  });
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}

export async function removeQuoteLine(lineId: string): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    await db.$transaction(async (tx) => {
      const line = await tx.quoteLine.findUnique({
        where: { id: lineId },
        include: { quote: { select: { id: true, status: true } } },
      });
      if (!line) throw new ActionError("Line not found");
      if (line.quote.status !== QuoteStatus.DRAFT) {
        throw new ActionError("Lines can only be removed from a DRAFT quote");
      }
      await tx.quoteLine.delete({ where: { id: lineId } });
      await recomputeQuoteTotals(tx, line.quote.id);
      await tx.auditLog.create({
        data: { userId: session.user.id, action: "QUOTE_LINE_REMOVED", entity: "Quote", entityId: line.quote.id },
      });
    });
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Recompute Quote.subtotal/taxTotal/grandTotal from the current line
 * set. Called after any line add/remove inside a DRAFT quote.
 */
async function recomputeQuoteTotals(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  quoteId: string,
): Promise<void> {
  const lines = await tx.quoteLine.findMany({
    where: { quoteId },
    select: { lineSubtotal: true, lineTax: true, lineTotal: true },
  });
  let subtotal = new Decimal(0);
  let taxTotal = new Decimal(0);
  let grandTotal = new Decimal(0);
  for (const l of lines) {
    subtotal = subtotal.plus(toDecimal(l.lineSubtotal));
    taxTotal = taxTotal.plus(toDecimal(l.lineTax));
    grandTotal = grandTotal.plus(toDecimal(l.lineTotal));
  }
  await tx.quote.update({
    where: { id: quoteId },
    data: {
      subtotal: subtotal.toDecimalPlaces(2).toString(),
      taxTotal: taxTotal.toDecimalPlaces(2).toString(),
      grandTotal: grandTotal.toDecimalPlaces(2).toString(),
    },
  });
}

// ─── Revise (issue a new version) ───────────────────────────────────────

/**
 * Clone the quote into a new DRAFT revision linked back to the parent.
 * The parent is left in its current state so the customer's "this is
 * what you sent me" link still resolves to the old prices; the new
 * draft can be edited freely and re-sent.
 */
export async function reviseQuote(parentId: string): Promise<ActionResultWith<{ id: string; quoteNo: string }>> {
  try {
    return await reviseQuoteInner(parentId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function reviseQuoteInner(parentId: string): Promise<{ ok: true; id: string; quoteNo: string }> {
  const session = await requireRole(WRITE_ROLES);
  const result = await db.$transaction(async (tx) => {
    const parent = await tx.quote.findUnique({
      where: { id: parentId },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    if (!parent) throw new ActionError("Parent quote not found");

    const quoteNo = await nextQuoteNumber(tx);
    const revision = await tx.quote.create({
      data: {
        quoteNo,
        customerId: parent.customerId,
        title: parent.title,
        eventDate: parent.eventDate,
        headcount: parent.headcount,
        mealType: parent.mealType,
        deliveryAddress: parent.deliveryAddress,
        placeOfSupplyStateCode: parent.placeOfSupplyStateCode,
        validUntil: parent.validUntil,
        notes: parent.notes,
        termsMd: parent.termsMd,
        status: QuoteStatus.DRAFT,
        version: parent.version + 1,
        parentQuoteId: parent.id,
        subtotal: parent.subtotal,
        taxTotal: parent.taxTotal,
        grandTotal: parent.grandTotal,
        createdById: session.user.id,
        shareToken: newShareToken(),
        lines: {
          create: parent.lines.map((l) => ({
            sortOrder: l.sortOrder,
            dishId: l.dishId,
            description: l.description,
            hsnSac: l.hsnSac,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            gstRatePct: l.gstRatePct,
            lineSubtotal: l.lineSubtotal,
            lineTax: l.lineTax,
            lineTotal: l.lineTotal,
          })),
        },
      },
    });
    await tx.quoteEvent.create({
      data: {
        quoteId: revision.id,
        kind: QuoteEventKind.REVISION_ISSUED,
        toStatus: QuoteStatus.DRAFT,
        note: `Revision of ${parent.quoteNo}`,
        actorUserId: session.user.id,
      },
    });
    // Flag the parent as REVISED so the dashboard doesn't keep nagging
    // about an already-superseded quote.
    if (parent.status !== QuoteStatus.CONVERTED && parent.status !== QuoteStatus.LOST) {
      await tx.quote.update({ where: { id: parent.id }, data: { status: QuoteStatus.REVISED } });
    }
    return revision;
  });
  revalidatePath("/quotes");
  return { ok: true, id: result.id, quoteNo: result.quoteNo };
}

// ─── Convert to Order ────────────────────────────────────────────────────

/**
 * Convert an ACCEPTED quote into a draft Order. Order goes straight to
 * PENDING_CHEF_APPROVAL (the new chef-first flow's first stop), pulling
 * dish references where present and the customer + event details from
 * the quote header.
 */
export async function convertQuoteToOrder(
  quoteId: string,
): Promise<ActionResultWith<{ orderId: string; orderCode: string }>> {
  try {
    return await convertQuoteToOrderInner(quoteId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function convertQuoteToOrderInner(
  quoteId: string,
): Promise<{ ok: true; orderId: string; orderCode: string }> {
  const session = await requireRole(WRITE_ROLES);
  const result = await db.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { id: quoteId },
      include: {
        customer: { select: { id: true } },
        lines: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!quote) throw new ActionError("Quote not found");
    if (quote.status !== QuoteStatus.ACCEPTED) {
      throw new ActionError(`Only accepted quotes can be converted (current: ${humanizeStatus(quote.status)})`);
    }
    if (quote.orderId) {
      throw new ActionError("Quote already has an order linked");
    }
    if (!quote.eventDate || !quote.mealType || !quote.deliveryAddress || !quote.headcount) {
      throw new ActionError("Quote is missing event date, meal type, delivery address, or headcount — fill these in before converting");
    }
    const orderableLines = quote.lines.filter((l) => l.dishId);
    if (orderableLines.length === 0) {
      throw new ActionError("No dish-backed lines on this quote — only dish-linked lines convert into order items");
    }

    // Pull dish details so OrderItem fields line up.
    const dishIds = orderableLines.map((l) => l.dishId!).filter(Boolean);
    const dishes = await tx.dish.findMany({
      where: { id: { in: dishIds } },
      select: { id: true, name: true, unit: true, hsnSac: true },
    });
    const dishMap = new Map(dishes.map((d) => [d.id, d]));

    const supplierState = indefineStateCode();
    const summary = summarise({
      lines: orderableLines.map((l) => ({
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        discountPct: l.discountPct.toString(),
        gstRatePct: l.gstRatePct.toString(),
      })),
      supplierStateCode: supplierState,
      placeOfSupplyStateCode: quote.placeOfSupplyStateCode,
    });

    // Generate an order code from the same FY sequence as native orders.
    const orderCode = await nextOrderCode(tx);
    const order = await tx.order.create({
      data: {
        code: orderCode,
        customerId: quote.customer.id,
        eventDate: quote.eventDate,
        headcount: quote.headcount,
        mealType: quote.mealType,
        deliveryAddress: quote.deliveryAddress,
        deliveryWindowStart: quote.eventDate,
        deliveryWindowEnd: quote.eventDate,
        placeOfSupplyStateCode: quote.placeOfSupplyStateCode,
        contractValue: summary.grandTotal.toString(),
        // Workflow v3: converted quotes go through admin first, same as
        // any other new order. The admin still has to explicitly approve
        // before the chef sees the order.
        status: OrderStatus.PENDING_ADMIN_APPROVAL,
        submittedAt: new Date(),
        createdById: session.user.id,
        notes: `Converted from quote ${quote.quoteNo}`,
        items: {
          create: orderableLines.map((l, idx) => ({
            sortOrder: idx,
            dishId: l.dishId!,
            unit: dishMap.get(l.dishId!)?.unit ?? l.unit,
            portions: l.quantity,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            gstRatePct: l.gstRatePct,
            lineSubtotal: l.lineSubtotal,
            lineTax: l.lineTax,
            lineTotal: l.lineTotal,
          })),
        },
      },
    });
    // Status guard: two concurrent converts can't both create an order —
    // the loser matches zero rows and the transaction (order included)
    // rolls back.
    const updated = await tx.quote.updateMany({
      where: { id: quoteId, status: QuoteStatus.ACCEPTED },
      data: { status: QuoteStatus.CONVERTED, convertedAt: new Date(), orderId: order.id },
    });
    if (updated.count === 0) {
      throw new ActionError("This quote was already converted — refresh the page.");
    }
    await tx.quoteEvent.create({
      data: {
        quoteId,
        kind: QuoteEventKind.NOTE,
        fromStatus: QuoteStatus.ACCEPTED,
        toStatus: QuoteStatus.CONVERTED,
        note: `Converted to order ${orderCode}`,
        actorUserId: session.user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "QUOTE_CONVERTED_TO_ORDER",
        entity: "Quote",
        entityId: quoteId,
        payloadHash: sha256Json({ orderId: order.id, orderCode }),
      },
    });
    return { orderId: order.id, orderCode };
  });

  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  revalidatePath("/orders");
  return { ok: true, ...result };
}

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listQuotes(opts: { status?: QuoteStatus[]; customerId?: string } = {}) {
  await requireRole(READ_ROLES);
  return db.quote.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
    },
    include: {
      customer: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getQuote(id: string) {
  await requireSession();
  return db.quote.findUnique({
    where: { id },
    include: {
      customer: true,
      createdBy: { select: { name: true } },
      lines: {
        include: { dish: { select: { name: true, code: true, unit: true } } },
        orderBy: { sortOrder: "asc" },
      },
      events: {
        include: { actor: { select: { name: true } } },
        orderBy: { at: "asc" },
      },
      parentQuote: { select: { id: true, quoteNo: true, version: true } },
      revisions: { select: { id: true, quoteNo: true, version: true, status: true } },
      order: { select: { id: true, code: true, status: true } },
    },
  });
}

/**
 * Read-only public view of a quote, gated by share token. No session
 * required — the customer follows the link emailed to them.
 */
export async function getQuoteByShareToken(token: string) {
  return db.quote.findUnique({
    where: { shareToken: token },
    include: {
      customer: { select: { name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
}

