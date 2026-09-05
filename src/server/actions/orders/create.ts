"use server";

/**
 * Taking the order. Create, edit while it is still a draft, and submit it into the
 * approval chain — where it goes next depends on who took it and on which channel.
 */

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { ApprovalDecision, OrderStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
import { hasRole, ORDER_SALES_ROLES, requireRole } from "@/server/rbac";
import { OrderCreateInput, OrderUpdateInput } from "@/lib/validators";
import { ActionError, actionFailure, type ActionResult, type ActionResultWith } from "@/server/action-result";
import { nextOrderCode } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { indefineStateCode } from "@/lib/org";
import { isImmediateChannel, isPackagePricedChannel } from "@/lib/order-channels";
import { getOrCreateHouseCustomerId } from "@/lib/house-customer";
import { notifyRoles } from "@/server/notification-core";
import { deferAfterResponse } from "@/server/defer";
import { formatIST, istToUtc } from "@/lib/time";
import { computeLine, notifyOrderToChef } from "./_shared";

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
    const isPackageChannel = isPackagePricedChannel(input.channel);
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
    const isPackageChannel = isPackagePricedChannel(effChannel);

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
