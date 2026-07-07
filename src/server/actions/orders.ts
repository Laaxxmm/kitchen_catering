"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  ApprovalDecision,
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  DeliveryStatus,
  OrderChannel,
  OrderStatus,
  ProductionJobStatus,
  Role,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  hasRole,
  ORDER_KITCHEN_ROLES,
  ORDER_MANAGER_ROLES,
  ORDER_SALES_ROLES,
  ORDER_STORE_ROLES,
  requireRole,
  requireSession,
} from "@/server/rbac";
import {
  OrderCreateInput,
  OrderManagerApprovalInput,
  OrderManagerOverrideInput,
  OrderStoreApprovalInput,
  OrderUpdateInput,
} from "@/lib/validators";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import { nextOrderCode } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { indefineStateCode } from "@/lib/org";
import { isImmediateChannel, channelWantsFeedback, isEventDeliveryChannel } from "@/lib/order-channels";
import { getOrCreateHouseCustomerId } from "@/lib/house-customer";
import { createNotification, notifyRoles } from "@/server/actions/notifications";
import { deferAfterResponse } from "@/server/defer";
import { formatIST, istToUtc } from "@/lib/time";

// Every role the middleware lets onto /orders must be listed here, or the
// page's listOrders call throws and the whole route crashes for that role.
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS,
  Role.DELIVERY, Role.FNB_SERVICE,
];

/**
 * Order confirmed — chef approved feasibility (or manager OK'd the
 * chef's proposed changes). Notify BOTH:
 *   - KITCHEN_HEAD: raise the ingredient requisition
 *   - DELIVERY:     prepare cutlery + event arrangements ahead of time
 * (admin / manager already see it in their queues, so we don't spam them).
 *
 * Runs outside the approving transaction; failures are swallowed by
 * notifyRoles → createNotification so they never break the approval.
 */
async function notifyOrderApproved(orderId: string) {
  try {
    await notifyOrderApprovedInner(orderId);
  } catch (err) {
    console.warn("[notify] order-approved fanout failed:", err);
  }
}

async function notifyOrderApprovedInner(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      code: true,
      eventDate: true,
      headcount: true,
      channel: true,
      customer: { select: { name: true } },
    },
  });
  if (!order) return;
  const evt = formatIST(order.eventDate, "dd MMM yyyy");
  // Off-site catering (banquet / ODC / packed) needs the delivery team to
  // prep cutlery + arrangements ahead of the event, so loop them in with a
  // clear instruction. In-house channels (room service / à la carte /
  // management) are served on the premises — no delivery prep, so it's the
  // chef + F&B service who get the heads-up.
  const eventDelivery = isEventDeliveryChannel(order.channel);
  const roles = eventDelivery
    ? [Role.KITCHEN_HEAD, Role.DELIVERY, Role.FNB_SERVICE]
    : [Role.KITCHEN_HEAD, Role.FNB_SERVICE, Role.DELIVERY];
  const body = eventDelivery
    ? `${order.channel} · ${order.headcount} pax · event ${evt}. Kitchen: raise requisition. Delivery: prep cutlery + arrangements, then mark ready. Service: ready it for the guest.`
    : `${order.channel} · ${order.headcount} pax · event ${evt}. Kitchen: raise requisition. Service: ready it for the guest.`;
  await notifyRoles(roles, {
    kind: "ORDER_APPROVED",
    title: `Order ${order.code} confirmed — ${order.customer.name}`,
    body,
    link: `/orders/${orderId}`,
    dedupeKey: `order-approved:${orderId}`,
  });
}

/**
 * Fire-and-forget: tell the right desk a freshly-submitted order has
 * landed in their queue. Immediate channels (room service / à la carte /
 * management) go straight to the chef; pre-booked catering waits on the
 * admin/manager commercial gate. Uses the GENERIC kind so no schema
 * change is needed; the chime in the notification bell does the rest.
 */
async function notifyOrderSubmitted(orderId: string) {
  try {
    await notifyOrderSubmittedInner(orderId);
  } catch (err) {
    console.warn("[notify] order-submitted fanout failed:", err);
  }
}

async function notifyOrderSubmittedInner(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      code: true,
      status: true,
      channel: true,
      headcount: true,
      eventDate: true,
      roomNumber: true,
      customer: { select: { name: true } },
    },
  });
  if (!order) return;
  const evt = formatIST(order.eventDate, "dd MMM yyyy");
  const where = order.roomNumber ? ` · Room ${order.roomNumber}` : "";
  if (order.status === OrderStatus.PENDING_CHEF_APPROVAL) {
    // In-house orders (room service / à la carte / management) go straight to
    // the chef — loop in F&B service too, since they take it to the guest.
    await notifyRoles([Role.KITCHEN_HEAD, Role.FNB_SERVICE, Role.DELIVERY], {
      kind: "GENERIC",
      title: `New order ${order.code} — ${order.customer.name}`,
      body: `${order.channel}${where} · ${order.headcount ?? "?"} pax. Chef: accept or reject. Service: prepare to serve.`,
      link: `/orders/${orderId}`,
      dedupeKey: `order-submitted:${orderId}`,
    });
  } else if (order.status === OrderStatus.PENDING_ADMIN_APPROVAL) {
    await notifyRoles([Role.ADMIN, Role.MANAGER], {
      kind: "GENERIC",
      title: `New order ${order.code} awaiting approval`,
      body: `${order.customer.name} · ${order.channel} · ${order.headcount ?? "?"} pax · event ${evt}.`,
      link: `/orders/${orderId}`,
      dedupeKey: `order-submitted:${orderId}`,
    });
  }
}

/**
 * Fire-and-forget: order cleared the manager gate, now needs chef review.
 * Fans out to the chef (review feasibility) AND gives the delivery team and
 * F&B service an early heads-up that an order is coming through.
 */
async function notifyOrderToChef(orderId: string) {
  try {
    await notifyOrderToChefInner(orderId);
  } catch (err) {
    console.warn("[notify] order-to-chef fanout failed:", err);
  }
}

async function notifyOrderToChefInner(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { code: true, customer: { select: { name: true } } },
  });
  if (!order) return;
  await notifyRoles([Role.KITCHEN_HEAD, Role.DELIVERY, Role.FNB_SERVICE], {
    kind: "GENERIC",
    title: `Order ${order.code} approved — chef review`,
    body: `${order.customer.name}: manager signed off. Chef: accept or suggest changes. Delivery & service: heads-up, an order is on the way.`,
    link: `/orders/${orderId}`,
    dedupeKey: `order-to-chef:${orderId}`,
  });
}

interface ComputedLine {
  subtotal: Decimal;
  tax: Decimal;
  total: Decimal;
}

function computeLine(portions: string, unitPrice: string, discountPct?: string, gstRatePct?: string): ComputedLine {
  const p = toDecimal(portions);
  const u = toDecimal(unitPrice);
  const d = toDecimal(discountPct ?? "0").div(100);
  const g = toDecimal(gstRatePct ?? "0").div(100);
  const gross = p.times(u);
  const subtotal = gross.times(new Decimal(1).minus(d));
  const tax = subtotal.times(g);
  return {
    subtotal: subtotal.toDecimalPlaces(2),
    tax: tax.toDecimalPlaces(2),
    total: subtotal.plus(tax).toDecimalPlaces(2),
  };
}

// =====================================================================
// CREATE / UPDATE / SUBMIT
// =====================================================================

export async function createOrder(raw: unknown): Promise<ActionResultWith<{ id: string; code: string }>> {
  try {
    return await createOrderInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createOrderInner(raw: unknown): Promise<{ ok: true; id: string; code: string }> {
  const session = await requireRole(ORDER_SALES_ROLES);
  const input = OrderCreateInput.parse(raw);

  const order = await db.$transaction(async (tx) => {
    const code = await nextOrderCode(tx);
    const itemsData = input.items.map((it, idx) => {
      const c = computeLine(it.portions, it.unitPrice, it.discountPct, it.gstRatePct);
      return {
        dishId: it.dishId,
        sortOrder: idx,
        portions: it.portions,
        unitPrice: it.unitPrice,
        discountPct: it.discountPct ?? "0",
        gstRatePct: it.gstRatePct ?? "0",
        lineSubtotal: c.subtotal.toString(),
        lineTax: c.tax.toString(),
        lineTotal: c.total.toString(),
        notes: it.notes ?? null,
      };
    });
    // For ODC / PACKET bulk orders the operator sets one lump-sum
    // package price; otherwise the contract value is the sum of the
    // per-dish line totals.
    const isPackageChannel =
      input.channel === "ODC" || input.channel === "PACKET";
    const lineSum = itemsData
      .reduce((s, it) => s.plus(new Decimal(it.lineTotal)), new Decimal(0))
      .toDecimalPlaces(2);
    const contractValue =
      isPackageChannel && input.packageTotal != null && input.packageTotal !== ""
        ? new Decimal(input.packageTotal).toDecimalPlaces(2)
        : lineSum;

    // Immediate channels (room service / à la carte / management) don't
    // collect event date, delivery address/window or place of supply — the
    // columns are NOT NULL, so fill sensible defaults: served now, to the
    // room/table, taxed at the hotel's own state.
    // The form sends IST clock time (from a datetime-local input); convert
    // through istToUtc so it's stored as the correct UTC instant. Using a bare
    // new Date() here parsed it as UTC on the server, shifting every event
    // ~5.5h forward (and across midnight) when shown back in IST.
    const eventDateVal = input.eventDate ? istToUtc(input.eventDate) : new Date();
    const deliveryAddressVal =
      input.deliveryAddress?.trim() ||
      (input.roomNumber?.trim()
        ? `Room ${input.roomNumber.trim()}`
        : input.tableNumber?.trim()
          ? `Table ${input.tableNumber.trim()}`
          : "In-house service");
    const windowStartVal = input.deliveryWindowStart ? istToUtc(input.deliveryWindowStart) : eventDateVal;
    const windowEndVal = input.deliveryWindowEnd ? istToUtc(input.deliveryWindowEnd) : eventDateVal;
    const placeOfSupplyVal = input.placeOfSupplyStateCode || indefineStateCode();

    // In-house orders may not name a guest — book them against the built-in
    // "House / Walk-in" customer (created on first use). Catering always has
    // a real customer (enforced by the validator).
    const customerId = input.customerId?.trim()
      ? input.customerId
      : await getOrCreateHouseCustomerId(tx);

    const created = await tx.order.create({
      data: {
        code,
        customerId,
        channel: input.channel,
        eventDate: eventDateVal,
        headcount: input.headcount,
        mealType: input.mealType,
        deliveryAddress: deliveryAddressVal,
        deliveryWindowStart: windowStartVal,
        deliveryWindowEnd: windowEndVal,
        placeOfSupplyStateCode: placeOfSupplyVal,
        roomNumber: input.roomNumber?.trim() || null,
        tableNumber: input.tableNumber?.trim() || null,
        notes: input.notes ?? null,
        contractValue: contractValue.toString(),
        status: OrderStatus.DRAFT,
        createdById: session.user.id,
        items: { create: itemsData },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_CREATED",
        entity: "Order",
        entityId: created.id,
        payloadHash: sha256Json({ code, items: itemsData.length }),
      },
    });
    return created;
  });

  revalidatePath("/orders");
  return { ok: true, id: order.id, code: order.code };
}

export async function updateOrderDraft(id: string, raw: unknown): Promise<ActionResult> {
  try {
    return await updateOrderDraftInner(id, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function updateOrderDraftInner(id: string, raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(ORDER_SALES_ROLES);
  const input = OrderUpdateInput.parse(raw);

  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      select: { status: true, channel: true },
    });
    if (!order) throw new ActionError("Order not found");
    if (order.status !== OrderStatus.DRAFT) {
      throw new ActionError("Only DRAFT orders can be edited");
    }

    // Header fields
    const data: Record<string, unknown> = {};
    if (input.customerId) data.customerId = input.customerId;
    if (input.channel) data.channel = input.channel;
    if (input.eventDate) data.eventDate = istToUtc(input.eventDate);
    if (input.headcount) data.headcount = input.headcount;
    if (input.mealType) data.mealType = input.mealType;
    if (input.deliveryAddress) data.deliveryAddress = input.deliveryAddress;
    if (input.deliveryWindowStart) data.deliveryWindowStart = istToUtc(input.deliveryWindowStart);
    if (input.deliveryWindowEnd) data.deliveryWindowEnd = istToUtc(input.deliveryWindowEnd);
    if (input.placeOfSupplyStateCode) data.placeOfSupplyStateCode = input.placeOfSupplyStateCode;
    if (input.roomNumber !== undefined) data.roomNumber = input.roomNumber?.trim() || null;
    if (input.tableNumber !== undefined) data.tableNumber = input.tableNumber?.trim() || null;
    if (input.notes !== undefined) data.notes = input.notes;

    // Effective channel = the one being set, else the order's current.
    const effChannel = input.channel ?? order.channel;
    const isPackageChannel = effChannel === "ODC" || effChannel === "PACKET";

    if (input.items) {
      // Full replace
      await tx.orderItem.deleteMany({ where: { orderId: id } });
      const itemsData = input.items.map((it, idx) => {
        const c = computeLine(it.portions, it.unitPrice, it.discountPct, it.gstRatePct);
        return {
          orderId: id,
          dishId: it.dishId,
          sortOrder: idx,
          portions: it.portions,
          unitPrice: it.unitPrice,
          discountPct: it.discountPct ?? "0",
          gstRatePct: it.gstRatePct ?? "0",
          lineSubtotal: c.subtotal.toString(),
          lineTax: c.tax.toString(),
          lineTotal: c.total.toString(),
          notes: it.notes ?? null,
        };
      });
      await tx.orderItem.createMany({ data: itemsData });
      const lineSum = itemsData
        .reduce((s, it) => s.plus(new Decimal(it.lineTotal)), new Decimal(0))
        .toDecimalPlaces(2);
      data.contractValue =
        isPackageChannel && input.packageTotal != null && input.packageTotal !== ""
          ? new Decimal(input.packageTotal).toDecimalPlaces(2).toString()
          : lineSum.toString();
    } else if (
      isPackageChannel &&
      input.packageTotal != null &&
      input.packageTotal !== ""
    ) {
      // Package total edited without touching the dish lines.
      data.contractValue = new Decimal(input.packageTotal)
        .toDecimalPlaces(2)
        .toString();
    }

    await tx.order.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_DRAFT_UPDATED",
        entity: "Order",
        entityId: id,
      },
    });
  });

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  return { ok: true };
}

/**
 * Submit a DRAFT order. Workflow v2: goes straight to the CHEF for
 * feasibility approval (no separate store-approval step). The chef can
 * either confirm or propose changes (which then need manager OK).
 *
 * The commercial gate (PENDING_ADMIN_APPROVAL) is the MANAGER's call, so
 * when a manager or admin takes the order themselves there's nobody left to
 * approve it to — it skips the gate and goes straight to the chef, with the
 * approval stamped on the record as the taker's own sign-off.
 */
export async function submitOrder(id: string): Promise<ActionResult> {
  try {
    return await submitOrderInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function submitOrderInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(ORDER_SALES_ROLES);
  // A manager / admin taking the order self-approves the commercial gate.
  const selfApproves = hasRole(session, [Role.ADMIN, Role.MANAGER]);

  // Immediate hotel-service channels (room service / à la carte /
  // management) skip the admin commercial gate and go straight to the
  // chef — these are walk-up / in-stay orders, not pre-booked catering.
  // They're also "now" orders, so we don't enforce a future event date.
  let skippedGate = false;
  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new ActionError("Order not found");
    if (order.status !== OrderStatus.DRAFT) {
      throw new ActionError("Only DRAFT orders can be submitted");
    }
    if (order.items.length === 0) throw new ActionError("Add at least one item before submitting");

    const immediateChannel = isImmediateChannel(order.channel);

    if (!immediateChannel && order.eventDate.getTime() <= Date.now()) {
      throw new ActionError("Event date must be in the future");
    }
    if (!order.deliveryAddress.trim()) throw new ActionError("Delivery address is required");

    // Catering orders normally stop at the manager gate first; but if the
    // taker IS a manager/admin, skip straight to the chef. Immediate channels
    // always skip it.
    const managerSelfApproved = selfApproves && !immediateChannel;
    skippedGate = managerSelfApproved;
    const nextStatus =
      immediateChannel || managerSelfApproved
        ? OrderStatus.PENDING_CHEF_APPROVAL // straight to chef
        : OrderStatus.PENDING_ADMIN_APPROVAL; // catering: manager signs off first

    // Status guard: a double-submit (two tabs / double-click) loses the
    // race and gets a clear message instead of double-transitioning.
    const updated = await tx.order.updateMany({
      where: { id, status: OrderStatus.DRAFT },
      data: {
        status: nextStatus,
        submittedAt: new Date(),
        // Record the manager's own sign-off so the order shows as approved
        // (by them) rather than mysteriously skipping the gate.
        ...(managerSelfApproved
          ? {
              adminReviewedById: session.user.id,
              adminReviewedAt: new Date(),
              adminDecision: ApprovalDecision.APPROVED,
              adminReviewNote: "Auto-approved — order taken by manager/admin",
            }
          : {}),
      },
    });
    if (updated.count === 0) {
      throw new ActionError("This order was already submitted — refresh the page.");
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_SUBMITTED",
        entity: "Order",
        entityId: id,
        payloadHash: sha256Json({ from: order.status, to: nextStatus }),
      },
    });
    if (managerSelfApproved) {
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ORDER_ADMIN_APPROVED",
          entity: "Order",
          entityId: id,
          payloadHash: sha256Json({ auto: true, reason: "taken by manager/admin" }),
        },
      });
    }
  });

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath("/queue/admin-approvals");
  revalidatePath("/queue/chef-approvals");

  // Chime the right desk. A manager-taken catering order jumps the gate, so
  // it lands in the chef's queue — send the same "approved, chef review"
  // heads-up (which also loops in delivery for event channels) rather than
  // the "awaiting approval" notice. Deferred — the submitter's button
  // shouldn't wait on the fan-out.
  if (skippedGate) {
    deferAfterResponse("submit:notify-chef", () => notifyOrderToChef(id));
  } else {
    deferAfterResponse("submit:notify", () => notifyOrderSubmitted(id));
  }
  return { ok: true };
}

/**
 * Admin gate — workflow v3. Every submitted order must pass this stop
 * before the chef sees it. Approval flips to PENDING_CHEF_APPROVAL and
 * stamps the admin's decision on the order; rejection is terminal
 * (REJECTED_BY_ADMIN), with a required reason.
 */
// The first commercial gate is the MANAGER's (admin may also act as an
// override). The DB columns + the PENDING_ADMIN_APPROVAL enum keep their
// historical names, but every user-facing label says "Manager".
export async function adminApproveOrder(
  id: string,
  input: { decision: "APPROVED" | "REJECTED"; note: string },
): Promise<ActionResult> {
  try {
    const session = await requireRole([Role.MANAGER, Role.ADMIN]);
    if (!input.note?.trim()) {
      throw new ActionError("A note is required — record why you approved or rejected");
    }
    if (input.decision !== "APPROVED" && input.decision !== "REJECTED") {
      throw new ActionError("Invalid decision");
    }

    await db.$transaction(async (tx) => {
      const next =
        input.decision === "APPROVED"
          ? OrderStatus.PENDING_CHEF_APPROVAL
          : OrderStatus.REJECTED_BY_ADMIN;

      // Status lives in the WHERE clause so two managers acting at once
      // can't both transition the order — the loser gets count 0.
      const updated = await tx.order.updateMany({
        where: { id, status: OrderStatus.PENDING_ADMIN_APPROVAL },
        data: {
          status: next,
          adminReviewedById: session.user.id,
          adminReviewedAt: new Date(),
          adminDecision: input.decision === "APPROVED" ? "APPROVED" : "REJECTED",
          adminReviewNote: input.note.trim(),
        },
      });
      if (updated.count === 0) {
        const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
        if (!order) throw new ActionError("Order not found");
        throw new ActionError(
          `Order is not awaiting manager approval (current: ${order.status}) — someone may have just acted on it. Refresh the page.`,
        );
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: input.decision === "APPROVED" ? "ORDER_ADMIN_APPROVED" : "ORDER_ADMIN_REJECTED",
          entity: "Order",
          entityId: id,
          payloadHash: sha256Json({ decision: input.decision, note: input.note.trim() }),
        },
      });
    });

    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/queue/admin-approvals");
    revalidatePath("/queue/chef-approvals");

    // On approval the order moves to the chef — chime them (deferred).
    if (input.decision === "APPROVED") {
      deferAfterResponse("admin-approve:notify-chef", () => notifyOrderToChef(id));
    }
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// =====================================================================
// CHEF-FIRST APPROVAL (workflow v2)
// =====================================================================

/**
 * Chef reviews the order. Two outcomes:
 *   - APPROVED          → CHEF_REQUISITION_PENDING (proforma is auto-emailed
 *                          to the customer in this transition)
 *   - SUGGESTED_CHANGES → CHANGES_PROPOSED_BY_CHEF (manager reviews)
 *
 * The chef writes a free-text note in both cases — for APPROVED it's a
 * confirmation note; for SUGGESTED_CHANGES it's the alternative menu /
 * timing note the manager needs to OK.
 */
export async function chefApproveOrder(
  id: string,
  input: { decision: "APPROVED" | "SUGGESTED_CHANGES"; note: string },
): Promise<ActionResult> {
  try {
    const session = await requireRole(ORDER_KITCHEN_ROLES);
    if (!input.note?.trim()) throw new ActionError("A note is required");

    let triggerProforma = false;

    await db.$transaction(async (tx) => {
      const nextStatus =
        input.decision === "APPROVED"
          ? OrderStatus.CHEF_REQUISITION_PENDING
          : OrderStatus.CHANGES_PROPOSED_BY_CHEF;

      const updated = await tx.order.updateMany({
        where: { id, status: OrderStatus.PENDING_CHEF_APPROVAL },
        data: {
          status: nextStatus,
          chefReviewedById: session.user.id,
          chefReviewedAt: new Date(),
          chefDecision: input.decision === "APPROVED"
            ? ApprovalDecision.APPROVED
            : ApprovalDecision.SUGGESTED_CHANGES,
          chefSuggestionNotes: input.note,
        },
      });
      if (updated.count === 0) {
        const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
        if (!order) throw new ActionError("Order not found");
        throw new ActionError(
          `Order is not awaiting chef approval (current: ${order.status}) — refresh the page.`,
        );
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: input.decision === "APPROVED" ? "ORDER_CHEF_APPROVED" : "ORDER_CHEF_SUGGESTED_CHANGES",
          entity: "Order",
          entityId: id,
          payloadHash: sha256Json({ decision: input.decision, note: input.note }),
        },
      });

      if (input.decision === "APPROVED") {
        triggerProforma = true;
      }
    });

    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/queue/chef-approvals");
    revalidatePath("/queue/manager-approvals");

    // Auto-create + email the proforma AFTER the response — the PDF render
    // + SMTP handshake took seconds and froze the chef's approve button.
    if (triggerProforma) {
      deferAfterResponse("chef-approve:proforma+notify", async () => {
        const { createProformaInvoiceForOrder } = await import("./customer-invoices");
        try {
          await createProformaInvoiceForOrder(id);
        } catch (err) {
          console.error(`[proforma] order ${id} failed:`, err);
        }
        // Confirm to kitchen + delivery now that the order is going ahead.
        await notifyOrderApproved(id);
      });
    }
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Manager reviews the chef's proposed changes. Two outcomes:
 *   - APPROVED → back to PENDING_CHEF_APPROVAL: the order returns to the
 *                chef's new-orders queue so they see the approved changes
 *                and formally accept before raising the requisition.
 *                (Product decision July 2026 — previously it skipped
 *                straight to CHEF_REQUISITION_PENDING; the chef never got
 *                a look at what was approved. The proforma is sent by the
 *                chef's own approval, as with any order.)
 *   - REJECTED → REJECTED_BY_MANAGER (terminal).
 *
 * Only callable from CHANGES_PROPOSED_BY_CHEF.
 */
export async function managerApproveChefSuggestion(
  id: string,
  input: { decision: "APPROVED" | "REJECTED"; note?: string },
): Promise<ActionResult> {
  try {
    const session = await requireRole(ORDER_MANAGER_ROLES);

    await db.$transaction(async (tx) => {
      const nextStatus =
        input.decision === "APPROVED"
          ? OrderStatus.PENDING_CHEF_APPROVAL
          : OrderStatus.REJECTED_BY_MANAGER;

      const updated = await tx.order.updateMany({
        where: { id, status: OrderStatus.CHANGES_PROPOSED_BY_CHEF },
        data: {
          status: nextStatus,
          managerChangeReviewedById: session.user.id,
          managerChangeReviewedAt: new Date(),
          managerChangeDecision:
            input.decision === "APPROVED" ? ApprovalDecision.APPROVED : ApprovalDecision.REJECTED,
          managerChangeNote: input.note ?? null,
          // Clear the chef's decision stamp so the order reads as freshly
          // awaiting chef review — their suggestion note stays on the record.
          ...(input.decision === "APPROVED"
            ? { chefDecision: null, chefReviewedAt: null, chefReviewedById: null }
            : {}),
        },
      });
      if (updated.count === 0) {
        const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
        if (!order) throw new ActionError("Order not found");
        throw new ActionError(
          `Order no longer has pending chef-proposed changes (current: ${order.status}) — someone may have just reviewed it. Refresh the page.`,
        );
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: input.decision === "APPROVED" ? "ORDER_MANAGER_APPROVED_CHANGES" : "ORDER_MANAGER_REJECTED_CHANGES",
          entity: "Order",
          entityId: id,
          payloadHash: sha256Json({ decision: input.decision, note: input.note ?? null }),
        },
      });
    });

    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/queue/manager-approvals");
    revalidatePath("/queue/chef-approvals");

    // Approved changes send the order BACK to the chef's queue — tell them
    // to review + accept. (The proforma goes out when the chef accepts,
    // exactly like a first-time approval.)
    if (input.decision === "APPROVED") {
      deferAfterResponse("manager-approve-changes:notify-chef", () =>
        notifyRoles([Role.KITCHEN_HEAD], {
          kind: "GENERIC",
          title: `Your proposed changes were approved`,
          body: `Order is back in your queue — review the approved changes, then accept to proceed to ingredients.`,
          link: `/orders/${id}`,
          dedupeKey: `order-changes-approved:${id}:${Date.now()}`,
        }),
      );
    }
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// =====================================================================
// LEGACY TWO-STAGE APPROVAL (workflow v1 — kept for reference)
// New orders never see PENDING_STORE_APPROVAL; these actions remain to
// process any in-flight v1 orders cleanly. Safe to delete in a future
// migration once there's confidence nothing references them.
// =====================================================================

export async function storeApproveOrder(id: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(ORDER_STORE_ROLES);
    const input = OrderStoreApprovalInput.parse(raw);

    await db.$transaction(async (tx) => {
      const nextStatus =
        input.decision === "APPROVED"
          ? OrderStatus.PENDING_MANAGER_APPROVAL
          : OrderStatus.REJECTED_BY_STORE;

      const updated = await tx.order.updateMany({
        where: { id, status: OrderStatus.PENDING_STORE_APPROVAL },
        data: {
          status: nextStatus,
          storeReviewedById: session.user.id,
          storeReviewedAt: new Date(),
          storeDecision: input.decision === "APPROVED" ? ApprovalDecision.APPROVED : ApprovalDecision.REJECTED,
          storeApprovalNote: input.note,
        },
      });
      if (updated.count === 0) {
        throw new ActionError("Order is not awaiting store approval — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: input.decision === "APPROVED" ? "ORDER_STORE_APPROVED" : "ORDER_STORE_REJECTED",
          entity: "Order",
          entityId: id,
          payloadHash: sha256Json({ decision: input.decision, note: input.note }),
        },
      });
    });

    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/queue/store-approvals");
    revalidatePath("/queue/manager-approvals");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function managerApproveOrder(id: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(ORDER_MANAGER_ROLES);
    const input = OrderManagerApprovalInput.parse(raw);

    await db.$transaction(async (tx) => {
      const nextStatus =
        input.decision === "APPROVED"
          ? OrderStatus.CHEF_REQUISITION_PENDING
          : OrderStatus.REJECTED_BY_MANAGER;

      const updated = await tx.order.updateMany({
        where: { id, status: OrderStatus.PENDING_MANAGER_APPROVAL },
        data: {
          status: nextStatus,
          managerReviewedById: session.user.id,
          managerReviewedAt: new Date(),
          managerDecision:
            input.decision === "APPROVED" ? ApprovalDecision.APPROVED : ApprovalDecision.REJECTED,
          managerApprovalNote: input.note ?? null,
        },
      });
      if (updated.count === 0) {
        throw new ActionError("Order is not awaiting manager approval — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: input.decision === "APPROVED" ? "ORDER_MANAGER_APPROVED" : "ORDER_MANAGER_REJECTED",
          entity: "Order",
          entityId: id,
          payloadHash: sha256Json({ decision: input.decision, note: input.note ?? null }),
        },
      });
    });

    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/queue/manager-approvals");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function managerOverrideStoreRejection(id: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(ORDER_MANAGER_ROLES);
    const input = OrderManagerOverrideInput.parse(raw);

    await db.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id, status: OrderStatus.REJECTED_BY_STORE },
        data: {
          status: OrderStatus.CHEF_REQUISITION_PENDING,
          managerReviewedById: session.user.id,
          managerReviewedAt: new Date(),
          managerDecision: ApprovalDecision.OVERRIDDEN,
          managerOverrideReason: input.reason,
        },
      });
      if (updated.count === 0) {
        throw new ActionError("Only store-rejected orders can be overridden — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ORDER_MANAGER_OVERRIDE",
          entity: "Order",
          entityId: id,
          payloadHash: sha256Json({ reason: input.reason }),
        },
      });
    });

    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/queue/manager-approvals");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function cancelOrder(id: string, reason: string): Promise<ActionResult> {
  try {
    return await cancelOrderInner(id, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function cancelOrderInner(id: string, reason: string): Promise<{ ok: true }> {
  const session = await requireRole(ORDER_MANAGER_ROLES);
  if (!reason.trim()) throw new ActionError("Cancellation reason is required");

  await db.$transaction(async (tx) => {
    // Status guard: terminal states can't be cancelled, and two concurrent
    // cancels can't both proceed.
    const updated = await tx.order.updateMany({
      where: { id, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: reason },
    });
    if (updated.count === 0) {
      const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!order) throw new ActionError("Order not found");
      throw new ActionError(`Order is already ${order.status}`);
    }

    // Close any open downstream work so it drops off the store / kitchen /
    // delivery queues — otherwise a cancelled order still shows a "hand over
    // ingredients" request, a production job to cook, or a live delivery.
    // (Already-issued stock isn't auto-reversed — that's a manual stock
    // adjustment decision, separate from clearing the work queue.)
    const openReqs = await tx.chefRequisition.findMany({
      where: {
        orderId: id,
        status: {
          in: [
            ChefRequisitionStatus.DRAFT,
            ChefRequisitionStatus.SUBMITTED,
            ChefRequisitionStatus.PARTIALLY_ISSUED,
          ],
        },
      },
      select: { id: true },
    });
    if (openReqs.length > 0) {
      const reqIds = openReqs.map((r) => r.id);
      await tx.chefRequisitionLine.updateMany({
        where: {
          requisitionId: { in: reqIds },
          status: {
            in: [
              ChefRequisitionLineStatus.PENDING,
              ChefRequisitionLineStatus.PARTIALLY_ISSUED,
              ChefRequisitionLineStatus.AWAITING_PROCUREMENT,
            ],
          },
        },
        data: { status: ChefRequisitionLineStatus.CANCELLED },
      });
      await tx.chefRequisition.updateMany({
        where: { id: { in: reqIds } },
        data: { status: ChefRequisitionStatus.CANCELLED },
      });
    }

    await tx.productionJob.updateMany({
      where: {
        orderId: id,
        status: {
          in: [
            ProductionJobStatus.QUEUED,
            ProductionJobStatus.PREP,
            ProductionJobStatus.COOKING,
            ProductionJobStatus.READY,
          ],
        },
      },
      data: { status: ProductionJobStatus.CANCELLED },
    });

    await tx.delivery.updateMany({
      where: {
        orderId: id,
        status: {
          in: [DeliveryStatus.SCHEDULED, DeliveryStatus.DISPATCHED, DeliveryStatus.IN_TRANSIT],
        },
      },
      data: { status: DeliveryStatus.CANCELLED },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_CANCELLED",
        entity: "Order",
        entityId: id,
        payloadHash: sha256Json({ reason, closedRequisitions: openReqs.length }),
      },
    });
  });

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/requisitions");
  revalidatePath("/kitchen");
  revalidatePath("/deliveries");
  return { ok: true };
}

/**
 * Allocate a staff member to collect the customer's feedback for an order.
 * The manager picks who's responsible; that person gets a tracked task + a
 * notification, and the assignment is stamped on the order so it's visible.
 * Only makes sense once the order has been delivered/served.
 */
export async function allocateOrderFeedback(
  orderId: string,
  assigneeId: string,
): Promise<ActionResultWith<{ taskId: string }>> {
  try {
    return await allocateOrderFeedbackInner(orderId, assigneeId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function allocateOrderFeedbackInner(
  orderId: string,
  assigneeId: string,
): Promise<{ ok: true; taskId: string }> {
  const session = await requireRole(ORDER_MANAGER_ROLES);
  if (!assigneeId) throw new ActionError("Pick a person to collect the feedback.");

  const [order, assignee] = await Promise.all([
    db.order.findUnique({
      where: { id: orderId },
      select: { id: true, code: true, status: true, customer: { select: { name: true } } },
    }),
    db.user.findUnique({ where: { id: assigneeId }, select: { id: true, active: true, name: true } }),
  ]);
  if (!order) throw new ActionError("Order not found");
  if (!assignee || !assignee.active) throw new ActionError("Pick an active staff member.");
  const eligible: OrderStatus[] = [
    OrderStatus.DELIVERED,
    OrderStatus.INVOICED,
    OrderStatus.PAID,
    OrderStatus.COMPLETED,
  ];
  if (!eligible.includes(order.status)) {
    throw new ActionError("Feedback can be allocated once the order has been delivered/served.");
  }

  const task = await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        feedbackAssigneeId: assigneeId,
        feedbackAssignedAt: new Date(),
        feedbackAssignedById: session.user.id,
      },
    });
    const t = await tx.task.create({
      data: {
        title: `Collect feedback — order ${order.code}`,
        description: `Reach out to ${order.customer.name} and record their feedback on order ${order.code}.`,
        priority: TaskPriority.NORMAL,
        status: TaskStatus.ASSIGNED,
        assignedToId: assigneeId,
        assignedById: session.user.id,
        targetDate: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_FEEDBACK_ALLOCATED",
        entity: "Order",
        entityId: orderId,
        payloadHash: sha256Json({ assigneeId }),
      },
    });
    return t;
  });

  deferAfterResponse("feedback-allocation:notify", () =>
    createNotification({
      userId: assigneeId,
      kind: "TASK_ASSIGNED",
      title: `Collect feedback — order ${order.code}`,
      body: `Get ${order.customer.name}'s feedback and record it.`,
      link: `/orders/${orderId}`,
      dedupeKey: `order-feedback:${task.id}`,
    }),
  );

  revalidatePath(`/orders/${orderId}`);
  return { ok: true, taskId: task.id };
}

/**
 * One-tap "Served" for in-house channels (room service / à la carte /
 * management). These aren't driver-delivered — the plate is carried to the
 * room/table — so they skip the whole delivery-scheduling flow. Marking
 * served moves the order READY → DELIVERED, which is the billable state the
 * room-service billing screen lists. Tolerant of a double-tap (already
 * served/billed = no-op). Mints the feedback-link token like a real delivery.
 */
export async function markInHouseServed(orderId: string): Promise<ActionResult> {
  try {
    const session = await requireRole([
      Role.ADMIN,
      Role.MANAGER,
      Role.KITCHEN_HEAD,
      Role.FNB_SERVICE,
      Role.DELIVERY,
    ]);
    await db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, code: true, status: true, channel: true, feedbackToken: true },
      });
      if (!order) throw new ActionError("Order not found");
      if (!isImmediateChannel(order.channel)) {
        throw new ActionError(
          "Only in-house orders (room service / à la carte / management) are served this way.",
        );
      }
      // Already served / billed — harmless no-op so a double-tap doesn't error.
      if (
        order.status === OrderStatus.DELIVERED ||
        order.status === OrderStatus.INVOICED ||
        order.status === OrderStatus.PAID ||
        order.status === OrderStatus.COMPLETED
      ) {
        return;
      }
      if (order.status !== OrderStatus.READY) {
        throw new ActionError(
          `Order ${order.code} isn't ready to serve yet (it's ${order.status}). It needs to be cooked first.`,
        );
      }
      const wantsFeedback = !order.feedbackToken && channelWantsFeedback(order.channel);
      // Guarded transition: a concurrent double-tap that already flipped the
      // order to DELIVERED simply matches zero rows (no-op, same as above).
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.READY },
        data: {
          status: OrderStatus.DELIVERED,
          ...(wantsFeedback
            ? { feedbackToken: randomBytes(24).toString("base64url"), feedbackSentAt: new Date() }
            : {}),
        },
      });
      if (updated.count === 0) return;
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ORDER_SERVED_INHOUSE",
          entity: "Order",
          entityId: orderId,
        },
      });
    });

    revalidatePath("/kitchen");
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/invoices/room-service");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Chef applies a dish swap directly on the order — e.g. an ingredient is
 * unavailable, so they substitute another dish. Replaces the order item's
 * dish, reprices that line from the new dish, and (for non-package channels)
 * recomputes the order's contract value. The order's items genuinely change,
 * so the requisition and everything downstream use the NEW dish. Allowed up
 * until the food is being cooked.
 */
export async function swapOrderItemDish(
  orderId: string,
  orderItemId: string,
  newDishId: string,
  reason?: string | null,
): Promise<ActionResult> {
  try {
    return await swapOrderItemDishInner(orderId, orderItemId, newDishId, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function swapOrderItemDishInner(
  orderId: string,
  orderItemId: string,
  newDishId: string,
  reason?: string | null,
): Promise<{ ok: true }> {
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD]);
  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, channel: true },
    });
    if (!order) throw new ActionError("Order not found");
    const SWAPPABLE: OrderStatus[] = [
      OrderStatus.PENDING_CHEF_APPROVAL,
      OrderStatus.CHANGES_PROPOSED_BY_CHEF,
      OrderStatus.CHEF_REQUISITION_PENDING,
      OrderStatus.ISSUING,
      OrderStatus.READY_FOR_PRODUCTION,
    ];
    if (!SWAPPABLE.includes(order.status)) {
      throw new ActionError(
        `Can't swap a dish once the order is ${order.status.toLowerCase()}.`,
      );
    }
    const item = await tx.orderItem.findFirst({
      where: { id: orderItemId, orderId },
      select: { id: true, portions: true, discountPct: true, dish: { select: { name: true } } },
    });
    if (!item) throw new ActionError("That dish isn't on this order.");
    const newDish = await tx.dish.findUnique({
      where: { id: newDishId },
      select: { id: true, name: true, unitPrice: true, gstRatePct: true },
    });
    if (!newDish) throw new ActionError("Replacement dish not found.");

    const c = computeLine(
      item.portions.toString(),
      newDish.unitPrice.toString(),
      item.discountPct.toString(),
      newDish.gstRatePct.toString(),
    );
    await tx.orderItem.update({
      where: { id: orderItemId },
      data: {
        dishId: newDish.id,
        unitPrice: newDish.unitPrice.toString(),
        gstRatePct: newDish.gstRatePct.toString(),
        lineSubtotal: c.subtotal.toString(),
        lineTax: c.tax.toString(),
        lineTotal: c.total.toString(),
      },
    });

    // Reprice the order (line-sum) except for ODC / PACKET, which carry a
    // fixed lump-sum package price.
    if (order.channel !== "ODC" && order.channel !== "PACKET") {
      const items = await tx.orderItem.findMany({ where: { orderId }, select: { lineTotal: true } });
      const total = items
        .reduce((s, it) => s.plus(toDecimal(it.lineTotal)), new Decimal(0))
        .toDecimalPlaces(2);
      await tx.order.update({ where: { id: orderId }, data: { contractValue: total.toString() } });
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_ITEM_SWAPPED",
        entity: "OrderItem",
        entityId: orderItemId,
        payloadHash: sha256Json({ from: item.dish.name, to: newDish.name, reason: reason ?? null }),
      },
    });
  });

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/requisition`);
  revalidatePath("/orders");
  return { ok: true };
}

export async function assignKitchenSupervisor(id: string, userId: string): Promise<ActionResult> {
  try {
    const session = await requireRole([...ORDER_MANAGER_ROLES, ...ORDER_KITCHEN_ROLES]);
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { kitchenSupervisorId: userId } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ORDER_KITCHEN_SUPERVISOR_ASSIGNED",
          entity: "Order",
          entityId: id,
          payloadHash: sha256Json({ kitchenSupervisorId: userId }),
        },
      });
    });
    revalidatePath(`/orders/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// =====================================================================
// QUERIES
// =====================================================================

export interface OrderFilter {
  status?: OrderStatus | OrderStatus[];
  customerId?: string;
  myQueue?: boolean;
  query?: string;
}

/** Count of orders per status across the whole table — drives the orders-page
 *  tab counts so they're accurate regardless of the active filter. */
export async function getOrderStatusCounts(): Promise<Partial<Record<OrderStatus, number>>> {
  const session = await requireRole(READ_ROLES);
  // F&B Service only sees in-house room orders — scope their tab counts to match.
  const fnbScoped =
    session.user.role === Role.DELIVERY || session.user.role === Role.FNB_SERVICE;
  const rows = await db.order.groupBy({
    by: ["status"],
    _count: { _all: true },
    ...(fnbScoped
      ? { where: { channel: { in: [OrderChannel.ROOM_SERVICE, OrderChannel.ALACARTE, OrderChannel.MANAGEMENT] } } }
      : {}),
  });
  const out: Partial<Record<OrderStatus, number>> = {};
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}

export async function listOrders(filter: OrderFilter = {}) {
  const session = await requireRole(READ_ROLES);

  // "My queue" maps to role-relevant statuses (workflow v2: chef-first).
  let statuses: OrderStatus[] | undefined;
  if (filter.myQueue) {
    if (hasRole(session, [Role.STORE_KEEPER])) {
      // Store no longer approves orders; their queue is the requisition
      // fulfilment list (/queue/issuing). Surface ISSUING orders here so
      // they can see what's in flight.
      statuses = [OrderStatus.ISSUING];
    } else if (hasRole(session, [Role.MANAGER])) {
      // Manager owns proposed-changes approval + everything in flight.
      statuses = [OrderStatus.CHANGES_PROPOSED_BY_CHEF];
    } else if (hasRole(session, [Role.KITCHEN_HEAD])) {
      // Chef's queue: orders waiting for chef-approval first, then
      // production work afterwards.
      statuses = [
        OrderStatus.PENDING_CHEF_APPROVAL,
        OrderStatus.CHEF_REQUISITION_PENDING,
        OrderStatus.ISSUING,
        OrderStatus.READY_FOR_PRODUCTION,
        OrderStatus.IN_PREP,
        OrderStatus.READY,
      ];
    } else if (hasRole(session, [Role.SALES])) {
      statuses = [OrderStatus.DRAFT, OrderStatus.PENDING_CHEF_APPROVAL, OrderStatus.CHANGES_PROPOSED_BY_CHEF];
    } else if (hasRole(session, [Role.DELIVERY])) {
      statuses = [OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY];
    }
  } else if (filter.status) {
    statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
  }

  // F&B Service (role DELIVERY, FNB_SERVICE its retired alias) only handles
  // in-house room orders — they see just those, not the whole catering book.
  const fnbScoped =
    session.user.role === Role.DELIVERY || session.user.role === Role.FNB_SERVICE;

  return db.order.findMany({
    where: {
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(fnbScoped
        ? { channel: { in: [OrderChannel.ROOM_SERVICE, OrderChannel.ALACARTE, OrderChannel.MANAGEMENT] } }
        : {}),
      ...(filter.query
        ? {
            OR: [
              { code: { contains: filter.query, mode: "insensitive" } },
              { customer: { name: { contains: filter.query, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getOrder(id: string) {
  await requireSession();
  return db.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { include: { dish: { select: { name: true, code: true, unit: true } } }, orderBy: { sortOrder: "asc" } },
      createdBy: { select: { name: true, email: true } },
      storeReviewedBy: { select: { name: true } },
      managerReviewedBy: { select: { name: true } },
      chefReviewedBy: { select: { name: true } },
      managerChangeReviewedBy: { select: { name: true } },
      kitchenSupervisor: { select: { name: true } },
      feedbackAssignee: { select: { name: true } },
      chefRequisitions: { select: { id: true, requisitionNo: true, status: true } },
    },
  });
}
