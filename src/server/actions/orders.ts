"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  ApprovalDecision,
  BanquetRequisitionStatus,
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  DeliveryStatus,
  MealType,
  OrderChannel,
  OrderStatus,
  Prisma,
  ProductionJobItemStatus,
  ProductionJobStatus,
  Role,
  TaskPriority,
  TaskStatus,
  VendorPOStatus,
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
  OrderReviseInput,
  OrderStoreApprovalInput,
  OrderUpdateInput,
} from "@/lib/validators";
import {
  FORCE_DELIVERABLE_ORDER_STATUSES,
  INACTIVE_ORDER_STATUSES,
  KITCHEN_COMMITTED_STATUSES,
  REVISABLE_ORDER_STATUSES,
  STATUS_LABEL,
} from "@/lib/order-status";
import {
  computeRevisionBand,
  isStaleAfterRevision,
  type RevisionBand,
  type RevisionDocumentType,
  type RevisionScope,
} from "@/lib/order-revision";
import { computeLine as computeGstLine } from "@/lib/gst";
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
import { isImmediateChannel, channelWantsFeedback, isEventDeliveryChannel, isPackagePricedChannel } from "@/lib/order-channels";
import { getOrCreateHouseCustomerId } from "@/lib/house-customer";
import { createNotification, notifyRoles } from "@/server/notification-core";
import { deferAfterResponse } from "@/server/defer";
import { cancelBanquetRequisitionsWithPOs } from "@/server/banquet-core";
import { formatIST, istToUtc, type DateWindow } from "@/lib/time";

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
    select: {
      code: true,
      channel: true,
      headcount: true,
      eventDate: true,
      customer: { select: { name: true } },
    },
  });
  if (!order) return;
  const evt = formatIST(order.eventDate, "EEE d MMM");
  const eventOrder = isEventDeliveryChannel(order.channel);
  // Chef: it's their move now.
  await notifyRoles([Role.KITCHEN_HEAD], {
    kind: "GENERIC",
    title: `Order ${order.code} approved — chef review`,
    body: `${order.customer.name} · ${order.channel} · ${order.headcount} pax · event ${evt}. Manager signed off — accept or suggest changes.`,
    link: `/orders/${orderId}`,
    dedupeKey: `order-to-chef:${orderId}`,
  });
  // F&B / delivery: package + event orders (banquet / buffet / ODC / packed)
  // need cutlery + arrangements planned ahead — tell them the moment the
  // manager approves, not only when the kitchen accepts.
  await notifyRoles([Role.DELIVERY, Role.FNB_SERVICE], {
    kind: "GENERIC",
    title: eventOrder
      ? `Event confirmed — ${order.code} on ${evt}`
      : `Order ${order.code} approved — heads-up`,
    body: eventOrder
      ? `${order.customer.name} · ${order.channel} · ${order.headcount} pax. Manager approved — start planning cutlery & arrangements; issue and mark event prep ready before the event.`
      : `${order.customer.name} · ${order.channel} · ${order.headcount} pax. Manager approved — an order is on the way.`,
    link: eventOrder ? `/deliveries/event-prep/${orderId}` : `/orders/${orderId}`,
    dedupeKey: `order-to-fnb:${orderId}`,
  });
}

interface ComputedLine {
  subtotal: Decimal;
  tax: Decimal;
  total: Decimal;
}

function computeLine(portions: string, unitPrice: string, discountPct?: string, gstRatePct?: string): ComputedLine {
  // Delegate to gst.computeLine so orders round line amounts the same way
  // invoices, POs and bills do (per-line round then sum). "portions" is this
  // domain's quantity.
  return computeGstLine({
    quantity: portions,
    unitPrice,
    discountPct: discountPct ?? "0",
    gstRatePct: gstRatePct ?? "0",
  });
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
 * Revise a confirmed order mid-flight — the client changed the headcount
 * (e.g. 50 → 30 pax). Quantities only: headcount, per-existing-line
 * portions (0 removes the line) and, for package-priced channels, the
 * renegotiated package total. Dishes and prices don't move here (dish
 * substitution is the chef's swap flow; full re-pricing means a new order).
 *
 * Allowed while the order is still in the kitchen's hands (up to READY);
 * refused once it's out for delivery / billed / terminal. Within 24h of the
 * event only a manager/admin may revise — sales must escalate.
 *
 * Already-issued stock is deliberately NOT auto-returned: the kitchen is
 * told to review the requisition instead, and any stock correction is a
 * manual adjustment decision (same policy as cancelOrder).
 */
export async function reviseOrder(id: string, raw: unknown): Promise<ActionResult> {
  try {
    return await reviseOrderInner(id, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function reviseOrderInner(id: string, raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.SALES]);
  const input = OrderReviseInput.parse(raw);

  const revised = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      // Dish names ride along so the revision record can say WHICH dish was
      // removed / re-portioned in plain words (the chef reads this).
      include: { items: { include: { dish: { select: { name: true } } } } },
    });
    if (!order) throw new ActionError("Order not found");
    if (!REVISABLE_ORDER_STATUSES.includes(order.status)) {
      throw new ActionError(
        KITCHEN_COMMITTED_STATUSES.includes(order.status)
          ? `This order can't be revised — it is already ${STATUS_LABEL[order.status].toLowerCase()}. The ingredients are issued and the kitchen is working to these numbers. Speak to the chef directly, and record what actually went out after the event.`
          : `Too late — the order is ${STATUS_LABEL[order.status].toLowerCase()}`,
      );
    }

    // 24-hour rule: close to the event the kitchen has already planned and
    // possibly cooked — only a manager/admin may change quantities then.
    const withinDayOfEvent =
      order.eventDate.getTime() - Date.now() < 24 * 60 * 60 * 1000;
    if (withinDayOfEvent && session.user.role === Role.SALES) {
      throw new ActionError(
        "Within 24 hours of the event — ask a manager/admin to make this change.",
      );
    }

    // Banded off the order as it stands right now (inside the transaction),
    // not off whatever the revision moves it to. A CRITICAL revision costs
    // real food, so it needs a human "yes, anyway" — the UI asks, but the
    // gate lives here regardless of what the UI does.
    const band = computeRevisionBand({ eventDate: order.eventDate, status: order.status });
    if (band === "CRITICAL" && !input.criticalConfirmed) {
      throw new ActionError(
        `The event is less than an hour away or the kitchen is already cooking (${STATUS_LABEL[order.status].toLowerCase()}). Confirm you want to revise it anyway — the chef and store will have to redo work.`,
      );
    }

    // Every submitted line must belong to this order.
    const byId = new Map(order.items.map((it) => [it.id, it]));
    for (const li of input.items) {
      if (!byId.has(li.id)) {
        throw new ActionError("A line in this revision no longer exists on the order — refresh and try again.");
      }
    }
    const removals = input.items.filter((li) => li.portions === 0);
    const keeps = input.items.filter((li) => li.portions > 0);
    // Lines the form didn't send stay untouched.
    const untouched = order.items.filter((it) => !input.items.some((li) => li.id === it.id));
    if (keeps.length + untouched.length + (input.addDishes?.length ?? 0) === 0) {
      throw new ActionError("An order needs at least one dish — cancel the order instead of zeroing every line.");
    }

    // Plain-words line diff for the revision record the chef reads.
    const lineChanges: Array<{ kind: "added" | "removed" | "portions"; dish: string; from?: string; to?: string }> = [];
    for (const r of removals) {
      lineChanges.push({ kind: "removed", dish: byId.get(r.id)!.dish.name });
    }

    if (removals.length > 0) {
      await tx.orderItem.deleteMany({
        where: { id: { in: removals.map((r) => r.id) }, orderId: id },
      });
    }
    // Recompute each kept line exactly like updateOrderDraft/computeLine —
    // same price, discount and GST, only the portions change.
    for (const li of keeps) {
      const existing = byId.get(li.id)!;
      if (Number(existing.portions.toString()) !== li.portions) {
        lineChanges.push({
          kind: "portions",
          dish: existing.dish.name,
          from: existing.portions.toString(),
          to: String(li.portions),
        });
      }
      const c = computeLine(
        String(li.portions),
        existing.unitPrice.toString(),
        existing.discountPct.toString(),
        existing.gstRatePct.toString(),
      );
      await tx.orderItem.update({
        where: { id: li.id },
        data: {
          portions: String(li.portions),
          lineSubtotal: c.subtotal.toString(),
          lineTax: c.tax.toString(),
          lineTotal: c.total.toString(),
        },
      });
    }

    // #16: ADD new dishes mid-flight. Priced server-side from each dish's
    // CURRENT catalogue price via computeLine — the client only names the
    // dish and portions, never a price. Runs before the contract-value
    // re-sum below so per-dish channels pick the new lines up; package
    // channels keep their lump sum regardless.
    const addedNames: string[] = [];
    if (input.addDishes && input.addDishes.length > 0) {
      const dishes = await tx.dish.findMany({
        where: { id: { in: input.addDishes.map((d) => d.dishId) } },
        select: { id: true, name: true, unitPrice: true, gstRatePct: true },
      });
      const dishById = new Map(dishes.map((d) => [d.id, d]));
      let sortOrder = order.items.reduce((m, it) => Math.max(m, it.sortOrder), -1) + 1;
      for (const add of input.addDishes) {
        const dish = dishById.get(add.dishId);
        if (!dish) {
          throw new ActionError("A dish in this revision no longer exists — refresh and try again.");
        }
        const c = computeLine(
          String(add.portions),
          dish.unitPrice.toString(),
          "0",
          dish.gstRatePct.toString(),
        );
        await tx.orderItem.create({
          data: {
            orderId: id,
            dishId: dish.id,
            sortOrder: sortOrder++,
            portions: String(add.portions),
            unitPrice: dish.unitPrice.toString(),
            discountPct: "0",
            gstRatePct: dish.gstRatePct.toString(),
            lineSubtotal: c.subtotal.toString(),
            lineTax: c.tax.toString(),
            lineTotal: c.total.toString(),
          },
        });
        addedNames.push(dish.name);
        lineChanges.push({ kind: "added", dish: dish.name, to: String(add.portions) });
      }
    }

    // Contract value: package channels carry the renegotiated lump sum
    // (kept as-is when the form doesn't send one); everything else is the
    // sum of the recomputed lines.
    const isPackageChannel = isPackagePricedChannel(order.channel);
    let contractValue: Decimal;
    if (isPackageChannel) {
      contractValue =
        input.packageTotal != null && input.packageTotal !== ""
          ? new Decimal(input.packageTotal).toDecimalPlaces(2)
          : toDecimal(order.contractValue);
    } else {
      const items = await tx.orderItem.findMany({
        where: { orderId: id },
        select: { lineTotal: true },
      });
      contractValue = items
        .reduce((s, it) => s.plus(toDecimal(it.lineTotal)), new Decimal(0))
        .toDecimalPlaces(2);
    }

    // Reschedule: only when the submitted date differs from the current one.
    // A new date must be in the future — but an UNCHANGED date is left alone
    // even if the event is already underway (same-day pax cuts are normal).
    let newEventDate: Date | null = null;
    if (input.eventDate) {
      const candidate = istToUtc(input.eventDate);
      if (candidate.getTime() !== order.eventDate.getTime()) {
        if (candidate.getTime() <= Date.now()) {
          throw new ActionError("The new event date must be in the future.");
        }
        newEventDate = candidate;
      }
    }

    // #14: meal-type change — applied only when it actually differs.
    const newMealType =
      input.mealType && input.mealType !== order.mealType ? input.mealType : null;

    // Status guard in the WHERE clause: if the order moved (e.g. went out
    // for delivery) between our read and this write, match zero rows and
    // roll the whole revision back.
    const updated = await tx.order.updateMany({
      where: { id, status: { in: REVISABLE_ORDER_STATUSES } },
      data: {
        headcount: input.headcount,
        contractValue: contractValue.toString(),
        ...(newEventDate ? { eventDate: newEventDate } : {}),
        ...(newMealType ? { mealType: newMealType } : {}),
        // Same write, so an order can never be revised without the boards
        // learning about it. Clearing both seen-stamps re-raises the alert
        // for a team that already acknowledged an earlier revision.
        lastRevisedAt: new Date(),
        revisionSeenByChefAt: null,
        revisionSeenByStoreAt: null,
      },
    });
    if (updated.count === 0) {
      const current = await tx.order.findUnique({ where: { id }, select: { status: true } });
      throw new ActionError(
        `Too late — the order is ${current ? STATUS_LABEL[current.status].toLowerCase() : "gone"}. Someone moved it while you were editing — refresh the page.`,
      );
    }

    // Readable revision record — the chef (and everyone else) sees exactly
    // what changed and the manager's note on the order page. The audit row
    // below only stores a hash, which nobody can read back.
    await tx.orderRevision.create({
      data: {
        orderId: id,
        revisedById: session.user.id,
        note: input.revisionNote ?? null,
        beforeHeadcount: order.headcount,
        afterHeadcount: input.headcount,
        beforeContractValue: order.contractValue.toString(),
        afterContractValue: contractValue.toString(),
        beforeEventDate: order.eventDate,
        afterEventDate: newEventDate ?? order.eventDate,
        beforeMealType: order.mealType,
        afterMealType: newMealType ?? order.mealType,
        lineChanges: lineChanges.length > 0 ? lineChanges : undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_REVISED",
        entity: "Order",
        entityId: id,
        payloadHash: sha256Json({
          before: {
            headcount: order.headcount,
            contractValue: order.contractValue.toString(),
            eventDate: order.eventDate.toISOString(),
            mealType: order.mealType,
          },
          after: {
            headcount: input.headcount,
            contractValue: contractValue.toString(),
            eventDate: (newEventDate ?? order.eventDate).toISOString(),
            mealType: newMealType ?? order.mealType,
          },
          removedLines: removals.length,
          addedDishes: addedNames,
          note: input.revisionNote,
        }),
      },
    });

    return { code: order.code, oldPax: order.headcount, newEventDate, newMealType, addedNames, band };
  });

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/kitchen");

  const noteParts = [
    revised.newEventDate
      ? `Rescheduled to ${formatIST(revised.newEventDate, "EEE d MMM yyyy HH:mm")}.`
      : null,
    revised.newMealType ? `Meal changed to ${revised.newMealType.toLowerCase().replace("_", " ")}.` : null,
    revised.addedNames.length > 0 ? `Added: ${revised.addedNames.join(", ")}.` : null,
    input.revisionNote,
  ]
    .filter(Boolean)
    .join(" ");
  deferAfterResponse("order-revise:notify", () =>
    notifyOrderRevised(id, revised.code, revised.oldPax, input.headcount, noteParts, revised.band),
  );
  return { ok: true };
}

/**
 * Fire-and-forget: tell the kitchen + service teams an in-flight order's
 * quantities changed. Names every downstream document the revision just
 * invalidated — the chef's ingredient requisition, the F&B requisition and
 * any purchase order raised for this order — because each is a separate
 * team who otherwise finds out by accident.
 */
async function notifyOrderRevised(
  orderId: string,
  code: string,
  oldPax: number | null,
  newPax: number,
  note: string,
  band: RevisionBand,
) {
  try {
    // Open = non-terminal and not fully issued/closed. Already-issued stock
    // and already-bought goods are not auto-returned, so each team has to
    // reconcile their own document by hand.
    const [openRequisition, openBanquetRequisition, openPo] = await Promise.all([
      db.chefRequisition.findFirst({
        where: {
          orderId,
          status: {
            in: [
              ChefRequisitionStatus.DRAFT,
              ChefRequisitionStatus.SUBMITTED,
              ChefRequisitionStatus.PARTIALLY_ISSUED,
            ],
          },
        },
        select: { id: true },
      }),
      db.banquetRequisition.findFirst({
        where: {
          orderId,
          status: {
            in: [
              BanquetRequisitionStatus.SUBMITTED,
              BanquetRequisitionStatus.PARTIALLY_ISSUED,
            ],
          },
        },
        select: { id: true },
      }),
      db.vendorPO.findFirst({
        where: {
          orderId,
          status: { notIn: [VendorPOStatus.CANCELLED, VendorPOStatus.CLOSED] },
        },
        select: { id: true },
      }),
    ]);
    const increased = oldPax != null && newPax > oldPax;
    const body =
      (band === "CRITICAL"
        ? "CRITICAL — the event is imminent or the food is already being made. "
        : band === "URGENT"
          ? "URGENT — the event is within a day or the store is already issuing. "
          : "") +
      note +
      (openRequisition
        ? " Review the ingredient requisition — quantities were planned for the old headcount."
        : "") +
      (openBanquetRequisition
        ? " Review the F&B requisition — it was raised against the old order."
        : "") +
      (openPo
        ? " A purchase order is open against this order — check it still buys the right quantities."
        : "") +
      (increased
        ? " You may need more ingredients — raise a top-up requisition for the extra."
        : "");
    // STORE_KEEPER included (#6/#19): the store preps against requisitions
    // that a revision may have just invalidated.
    await notifyRoles([Role.KITCHEN_HEAD, Role.DELIVERY, Role.FNB_SERVICE, Role.STORE_KEEPER], {
      kind: "GENERIC",
      title: `Order ${code} revised — ${oldPax ?? "?"} → ${newPax} pax`,
      body,
      link: `/orders/${orderId}`,
      // Every revision is news — timestamp the key so repeats aren't deduped.
      dedupeKey: `order-revised:${orderId}:${Date.now()}`,
    });
  } catch (err) {
    console.warn("[notify] order-revised fanout failed:", err);
  }
}

// Who may read a scope's revision board and clear its stamp. Chef and store
// each see their own; the manager who made the revision sees both, since
// chasing it up is their job.
const REVISION_SCOPE_ROLES: Record<RevisionScope, Role[]> = {
  chef: [...ORDER_KITCHEN_ROLES, Role.MANAGER],
  store: [...ORDER_STORE_ROLES, Role.MANAGER],
};

// Each downstream document is acknowledged by the desk that owns it.
// BanquetRequisition mirrors REQUISITION_ROLES in actions/banquet.ts (F&B
// raises them, the store counter fulfils them).
const REVISION_DOCUMENT_GATES: Record<
  RevisionDocumentType,
  { roles: Role[]; entity: string }
> = {
  CHEF_REQUISITION: { roles: ORDER_KITCHEN_ROLES, entity: "ChefRequisition" },
  BANQUET_REQUISITION: {
    roles: [Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER],
    entity: "BanquetRequisition",
  },
  VENDOR_PO: { roles: [...ORDER_STORE_ROLES, Role.MANAGER], entity: "VendorPO" },
};

/** One row of `listRevisedOrders` — a revised order still owing a team a look. */
export interface RevisedOrderRow {
  id: string;
  code: string;
  customerName: string;
  eventDate: Date;
  status: OrderStatus;
  headcount: number;
  lastRevisedAt: Date;
  band: RevisionBand;
  /** Latest revision on the order — null only if the record was purged. */
  revision: {
    createdAt: Date;
    note: string | null;
    beforeHeadcount: number;
    afterHeadcount: number;
    beforeEventDate: Date;
    afterEventDate: Date;
    beforeMealType: MealType;
    afterMealType: MealType;
    /** [{kind:"added"|"removed"|"portions", dish, from?, to?}] */
    lineChanges: Prisma.JsonValue;
  } | null;
  /** This scope's documents raised before the revision and not re-checked since. */
  documents: Array<{
    type: RevisionDocumentType;
    id: string;
    number: string;
    status: string;
  }>;
}

/**
 * The revisions a team still owes a look at, newest revision first. An order
 * shows up while EITHER that team hasn't acknowledged the revision itself,
 * OR one of their documents predates it and hasn't been re-checked — so
 * clearing the order-level flag doesn't hide a requisition still built for
 * the old headcount. Terminal orders are excluded: nothing left to redo.
 */
export async function listRevisedOrders(scope: RevisionScope): Promise<RevisedOrderRow[]> {
  await requireRole(REVISION_SCOPE_ROLES[scope]);
  const rows = await db.order.findMany({
    where: { lastRevisedAt: { not: null }, status: { notIn: INACTIVE_ORDER_STATUSES } },
    select: {
      id: true,
      code: true,
      eventDate: true,
      status: true,
      headcount: true,
      lastRevisedAt: true,
      revisionSeenByChefAt: true,
      revisionSeenByStoreAt: true,
      customer: { select: { name: true } },
      orderRevisions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          createdAt: true,
          note: true,
          beforeHeadcount: true,
          afterHeadcount: true,
          beforeEventDate: true,
          afterEventDate: true,
          beforeMealType: true,
          afterMealType: true,
          lineChanges: true,
        },
      },
      // All three sets are fetched and the scope picks from them in memory:
      // staleness compares two columns (lastRevisedAt vs ackAt/createdAt),
      // which Prisma can't express in a where clause.
      chefRequisitions: {
        where: { status: { not: ChefRequisitionStatus.CANCELLED } },
        select: { id: true, requisitionNo: true, status: true, createdAt: true, revisionAckAt: true },
      },
      banquetRequisitions: {
        where: { status: { not: BanquetRequisitionStatus.CANCELLED } },
        select: { id: true, requisitionNo: true, status: true, createdAt: true, revisionAckAt: true },
      },
      vendorPos: {
        where: { status: { not: VendorPOStatus.CANCELLED } },
        select: { id: true, poNo: true, status: true, createdAt: true, revisionAckAt: true },
      },
    },
    orderBy: { lastRevisedAt: "desc" },
    take: 200,
  });

  const now = new Date();
  return rows.flatMap((o) => {
    // Non-null by the where clause above; Prisma can't narrow it for us.
    const lastRevisedAt = o.lastRevisedAt!;
    const docs =
      scope === "chef"
        ? o.chefRequisitions.map((r) => ({
            type: "CHEF_REQUISITION" as const,
            id: r.id,
            number: r.requisitionNo,
            status: String(r.status),
            createdAt: r.createdAt,
            ackAt: r.revisionAckAt,
          }))
        : [
            ...o.banquetRequisitions.map((r) => ({
              type: "BANQUET_REQUISITION" as const,
              id: r.id,
              number: r.requisitionNo,
              status: String(r.status),
              createdAt: r.createdAt,
              ackAt: r.revisionAckAt,
            })),
            ...o.vendorPos.map((p) => ({
              type: "VENDOR_PO" as const,
              id: p.id,
              number: p.poNo,
              status: String(p.status),
              createdAt: p.createdAt,
              ackAt: p.revisionAckAt,
            })),
          ];
    const stale = docs.filter((d) =>
      isStaleAfterRevision({ lastRevisedAt, ackAt: d.ackAt, createdAt: d.createdAt }),
    );
    const seenAt = scope === "chef" ? o.revisionSeenByChefAt : o.revisionSeenByStoreAt;
    const unseen = !seenAt || seenAt.getTime() < lastRevisedAt.getTime();
    if (!unseen && stale.length === 0) return [];
    return [
      {
        id: o.id,
        code: o.code,
        customerName: o.customer.name,
        eventDate: o.eventDate,
        status: o.status,
        headcount: o.headcount,
        lastRevisedAt,
        band: computeRevisionBand({ eventDate: o.eventDate, status: o.status, now }),
        revision: o.orderRevisions[0] ?? null,
        documents: stale.map((d) => ({
          type: d.type,
          id: d.id,
          number: d.number,
          status: d.status,
        })),
      },
    ];
  });
}

/**
 * A named human confirms their team has seen the revision. Stamps that
 * team's seen column and logs who — this is the accountability record, so
 * "nobody told the kitchen" stops being arguable. Only stamps an order that
 * actually carries a revision.
 */
export async function acknowledgeOrderRevision(
  orderId: string,
  scope: RevisionScope,
): Promise<ActionResult> {
  try {
    const session = await requireRole(REVISION_SCOPE_ROLES[scope]);
    const seenAt = new Date();
    await db.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, lastRevisedAt: { not: null } },
        data:
          scope === "chef"
            ? { revisionSeenByChefAt: seenAt }
            : { revisionSeenByStoreAt: seenAt },
      });
      if (updated.count === 0) {
        throw new ActionError("Nothing to acknowledge — this order has no revision on it.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: scope === "chef" ? "ORDER_REVISION_SEEN_CHEF" : "ORDER_REVISION_SEEN_STORE",
          entity: "Order",
          entityId: orderId,
          payloadHash: sha256Json({ scope, seenAt: seenAt.toISOString() }),
        },
      });
    });
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    revalidatePath("/kitchen");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Confirm one downstream document has been re-checked against the latest
 * revision — the requisition's quantities re-done, the PO verified. Clears
 * that document off the revision board without touching the others, so a
 * chef who fixed their requisition doesn't silently sign off the store's
 * purchase order too.
 */
export async function acknowledgeRevisedDocument(
  type: RevisionDocumentType,
  documentId: string,
): Promise<ActionResult> {
  try {
    const gate = REVISION_DOCUMENT_GATES[type];
    const session = await requireRole(gate.roles);
    const revisionAckAt = new Date();
    const where = { id: documentId };
    const data = { revisionAckAt };
    const { count } =
      type === "CHEF_REQUISITION"
        ? await db.chefRequisition.updateMany({ where, data })
        : type === "BANQUET_REQUISITION"
          ? await db.banquetRequisition.updateMany({ where, data })
          : await db.vendorPO.updateMany({ where, data });
    if (count === 0) {
      throw new ActionError("That document no longer exists — refresh and try again.");
    }
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_REVISION_DOCUMENT_ACKED",
        entity: gate.entity,
        entityId: documentId,
        payloadHash: sha256Json({ type, revisionAckAt: revisionAckAt.toISOString() }),
      },
    });
    revalidatePath("/orders");
    revalidatePath("/kitchen");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
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
          `Order is not awaiting manager approval (current: ${STATUS_LABEL[order.status].toLowerCase()}) — someone may have just acted on it. Refresh the page.`,
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
          `Order is not awaiting chef approval (current: ${STATUS_LABEL[order.status].toLowerCase()}) — refresh the page.`,
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
        const { createProformaInvoiceForOrderCore } = await import("@/server/customer-invoices-core");
        try {
          await createProformaInvoiceForOrderCore(id);
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
          `Order no longer has pending chef-proposed changes (current: ${STATUS_LABEL[order.status].toLowerCase()}) — someone may have just reviewed it. Refresh the page.`,
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

/**
 * Close every open piece of downstream work hanging off an order —
 * requisitions, production jobs + their items, deliveries, banquet
 * requisitions (and the shortfall POs they spawned). Shared by
 * {@link cancelOrder} and {@link forceDeliverOrder}: both end the order's
 * live workflow, so both must clear the store / kitchen / delivery queues.
 * Otherwise a dead order still shows a "hand over ingredients" request or a
 * job to cook. Live vendor POs are collected, never cancelled — goods may
 * already be inbound, so a human reviews them.
 *
 * Already-issued stock is not reversed; that's a manual stock-adjustment
 * decision, separate from clearing the work queue.
 */
async function closeOpenOrderWork(
  tx: Prisma.TransactionClient,
  orderId: string,
  userId: string,
  reason: string,
): Promise<{ closedRequisitions: number; banquetReqNos: string[]; reviewPoNos: string[] }> {
    // Close any open downstream work so it drops off the store / kitchen /
    // delivery queues — otherwise a cancelled order still shows a "hand over
    // ingredients" request, a production job to cook, or a live delivery.
    // (Already-issued stock isn't auto-reversed — that's a manual stock
    // adjustment decision, separate from clearing the work queue.)
    const openReqs = await tx.chefRequisition.findMany({
      where: {
        orderId,
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

    // Cancel the open production items first, then the jobs themselves.
    // Leaving non-terminal items live would let a stale kitchen tap flip the
    // last one to READY and cascade the cancelled order back to life
    // (READY items are kept as history, matching how the job is cancelled).
    const orderJobs = await tx.productionJob.findMany({
      where: { orderId },
      select: { id: true },
    });
    if (orderJobs.length > 0) {
      await tx.productionJobItem.updateMany({
        where: {
          jobId: { in: orderJobs.map((j) => j.id) },
          status: { in: [ProductionJobItemStatus.QUEUED, ProductionJobItemStatus.IN_PROGRESS] },
        },
        data: { status: ProductionJobItemStatus.CANCELLED },
      });
    }

    await tx.productionJob.updateMany({
      where: {
        orderId,
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
        orderId,
        status: {
          in: [DeliveryStatus.SCHEDULED, DeliveryStatus.DISPATCHED, DeliveryStatus.IN_TRANSIT],
        },
      },
      data: { status: DeliveryStatus.CANCELLED },
    });

    // H7(a): open banquet requisitions for this event — cancel them (and any
    // shortfall PO their lines spawned) so cutlery isn't picked for a dead
    // event. Same store-close line handling cancelBanquetRequisition uses.
    const openBanquetReqs = await tx.banquetRequisition.findMany({
      where: {
        orderId,
        status: {
          in: [BanquetRequisitionStatus.SUBMITTED, BanquetRequisitionStatus.PARTIALLY_ISSUED],
        },
      },
      select: { id: true },
    });
    const banquet = await cancelBanquetRequisitionsWithPOs(
      tx,
      openBanquetReqs.map((r) => r.id),
      userId,
      reason,
    );

    // H7(b): live vendor POs linked directly to this order — do NOT cancel
    // (goods may already be inbound), just collect them to notify for review.
    const orderPOs = await tx.vendorPO.findMany({
      where: {
        orderId,
        status: {
          notIn: [VendorPOStatus.CANCELLED, VendorPOStatus.CLOSED, VendorPOStatus.RECEIVED],
        },
      },
      select: { poNo: true },
    });

  return {
    closedRequisitions: openReqs.length,
    banquetReqNos: banquet.requisitionNos,
    reviewPoNos: [...orderPOs.map((p) => p.poNo), ...banquet.reviewPoNos],
  };
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

  const cascade = await db.$transaction(async (tx) => {
    // Status guard: terminal states can't be cancelled, and two concurrent
    // cancels can't both proceed. PAID is excluded too — a paid order must
    // have its payment reversed first (which demotes it to INVOICED), so the
    // money and the cancellation can't disagree.
    const updated = await tx.order.updateMany({
      where: {
        id,
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED, OrderStatus.PAID] },
      },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: reason },
    });
    if (updated.count === 0) {
      const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!order) throw new ActionError("Order not found");
      if (order.status === OrderStatus.PAID) {
        throw new ActionError("This order is fully paid — reverse the payment first, then cancel.");
      }
      throw new ActionError(`Order is already ${STATUS_LABEL[order.status].toLowerCase()}`);
    }
    const { code: orderCode } = (await tx.order.findUnique({
      where: { id },
      select: { code: true },
    }))!;

    const closed = await closeOpenOrderWork(tx, id, session.user.id, reason.trim());

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_CANCELLED",
        entity: "Order",
        entityId: id,
        payloadHash: sha256Json({
          reason,
          closedRequisitions: closed.closedRequisitions,
          closedBanquetRequisitions: closed.banquetReqNos.length,
          linkedPOsToReview: closed.reviewPoNos.length,
        }),
      },
    });
    return {
      orderCode,
      // POs to review: order-linked (H7b) + banquet shortfall POs already in
      // flight that couldn't be auto-cancelled (M17-style).
      banquetReqNos: closed.banquetReqNos,
      reviewPoNos: closed.reviewPoNos,
    };
  });

  // Best-effort fan-out — the cancel itself is already committed.
  if (cascade.banquetReqNos.length > 0) {
    deferAfterResponse("order-cancel:banquet-notify", () =>
      notifyRoles([Role.STORE_KEEPER], {
        kind: "GENERIC",
        title: `Event ${cascade.orderCode} cancelled`,
        body: `Event cancelled — disregard requisition ${cascade.banquetReqNos.join(", ")}.`,
        link: "/banquet/requisitions",
        dedupeKey: `order-cancel-banquet:${id}`,
      }),
    );
  }
  if (cascade.reviewPoNos.length > 0) {
    deferAfterResponse("order-cancel:po-notify", () =>
      notifyRoles([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER], {
        kind: "GENERIC",
        title: `${cascade.orderCode} cancelled — review purchase order ${cascade.reviewPoNos.join(", ")}`,
        body: `Order ${cascade.orderCode} cancelled — review linked purchase order ${cascade.reviewPoNos.join(", ")} before goods arrive.`,
        link: "/procurement/purchase-orders",
        dedupeKey: `order-cancel-po:${id}`,
      }),
    );
  }

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/requisitions");
  revalidatePath("/kitchen");
  revalidatePath("/deliveries");
  revalidatePath("/banquet/requisitions");
  revalidatePath("/procurement/purchase-orders");
  return { ok: true };
}

/**
 * Admin/manager override: mark a stuck order as cooked and delivered so it
 * can be invoiced. The escape hatch for orders the team completed in real
 * life while the paperwork stalled somewhere in the middle — without it the
 * only way out is cancelling an event that actually earned revenue.
 *
 * Closes the same downstream work {@link cancelOrder} does, so the store and
 * kitchen boards don't keep showing jobs for an order that's already been
 * served. Requires a reason, which lands in the audit log — this skips the
 * normal controls, so it has to be traceable.
 */
export async function forceDeliverOrder(id: string, reason: string): Promise<ActionResult> {
  try {
    return await forceDeliverOrderInner(id, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function forceDeliverOrderInner(id: string, reason: string): Promise<{ ok: true }> {
  const session = await requireRole(ORDER_MANAGER_ROLES);
  if (!reason.trim()) throw new ActionError("A reason is required to force an order through.");

  const cascade = await db.$transaction(async (tx) => {
    // Guarded transition — a concurrent override, cancel or genuine
    // delivery matches zero rows and we report the real status back.
    const updated = await tx.order.updateMany({
      where: { id, status: { in: FORCE_DELIVERABLE_ORDER_STATUSES } },
      data: { status: OrderStatus.DELIVERED },
    });
    if (updated.count === 0) {
      const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!order) throw new ActionError("Order not found");
      if (order.status === OrderStatus.CANCELLED) {
        throw new ActionError("This order is cancelled — it can't be marked delivered.");
      }
      throw new ActionError(
        `Order is ${STATUS_LABEL[order.status].toLowerCase()} — there's nothing to force. It's already past delivery.`,
      );
    }
    const { code: orderCode } = (await tx.order.findUnique({
      where: { id },
      select: { code: true },
    }))!;

    const closed = await closeOpenOrderWork(tx, id, session.user.id, reason.trim());
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_FORCE_DELIVERED",
        entity: "Order",
        entityId: id,
        payloadHash: sha256Json({
          reason: reason.trim(),
          closedRequisitions: closed.closedRequisitions,
          closedBanquetRequisitions: closed.banquetReqNos.length,
          linkedPOsToReview: closed.reviewPoNos.length,
        }),
      },
    });
    return { orderCode, reviewPoNos: closed.reviewPoNos };
  });

  // Linked POs stay live (goods may be inbound) — flag them for a human.
  if (cascade.reviewPoNos.length > 0) {
    deferAfterResponse("order-force-deliver:po-notify", () =>
      notifyRoles([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER], {
        kind: "GENERIC",
        title: `${cascade.orderCode} closed — review purchase order ${cascade.reviewPoNos.join(", ")}`,
        body: `Order ${cascade.orderCode} was marked delivered by override — review linked purchase order ${cascade.reviewPoNos.join(", ")}.`,
        link: "/procurement/purchase-orders",
        dedupeKey: `order-force-deliver-po:${id}`,
      }),
    );
  }

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/requisitions");
  revalidatePath("/kitchen");
  revalidatePath("/deliveries");
  revalidatePath("/banquet/requisitions");
  return { ok: true };
}

/**
 * Close a fully-paid order — flips PAID → COMPLETED (the terminal state).
 * New orders auto-complete the moment their invoice settles; this is the
 * manual path for orders that were left at PAID before the auto-flip
 * existed, and doubles as an explicit "close it out" for admin/manager.
 */
export async function closeOrder(id: string): Promise<ActionResult> {
  try {
    return await closeOrderInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function closeOrderInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(ORDER_MANAGER_ROLES);
  await db.$transaction(async (tx) => {
    // Guarded PAID → COMPLETED: only a fully-paid order can be closed, and a
    // concurrent close/reversal loses the race cleanly.
    const updated = await tx.order.updateMany({
      where: { id, status: OrderStatus.PAID },
      data: { status: OrderStatus.COMPLETED },
    });
    if (updated.count === 0) {
      const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!order) throw new ActionError("Order not found");
      throw new ActionError("Only a fully-paid order can be closed — refresh the page.");
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_CLOSED",
        entity: "Order",
        entityId: id,
      },
    });
  });
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
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
      // Link to the assignee's task, not the order — housekeeping/maintenance
      // staff can't open /orders/{id}, but /tasks/{id} is open to any
      // authenticated user (AUDIT_REPORT M15).
      link: `/tasks/${task.id}`,
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
          `Order ${order.code} isn't ready to serve yet (it's ${STATUS_LABEL[order.status].toLowerCase()}). It needs to be cooked first.`,
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
        `Can't swap a dish once the order is ${STATUS_LABEL[order.status].toLowerCase()}.`,
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
    if (!isPackagePricedChannel(order.channel)) {
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
  /** Optional half-open eventDate window — resolve IST day boundaries with
   *  the helpers in @/lib/time (istScopeWindow etc.) before passing. */
  eventFrom?: Date;
  eventToExclusive?: Date;
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
      ...(filter.eventFrom || filter.eventToExclusive
        ? {
            eventDate: {
              ...(filter.eventFrom ? { gte: filter.eventFrom } : {}),
              ...(filter.eventToExclusive ? { lt: filter.eventToExclusive } : {}),
            },
          }
        : {}),
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

/**
 * Confirmed catering orders the store still needs to stock for — chef has
 * accepted the order (CHEF_APPROVED) through to cooked (READY), before it's
 * dispatched. Excludes DRAFT / pending-approval (not yet confirmed) and
 * OUT_FOR_DELIVERY onward + terminal states (nothing left to stock). Single
 * source for the "confirmed but not yet delivered" window the store plans
 * against.
 */
const STORE_UPCOMING_STATUSES: OrderStatus[] = [
  OrderStatus.CHEF_APPROVED,
  OrderStatus.CHEF_REQUISITION_PENDING,
  OrderStatus.ISSUING,
  OrderStatus.READY_FOR_PRODUCTION,
  OrderStatus.IN_PREP,
  OrderStatus.READY,
];

/**
 * #5: read-only forward view for the store keeper — every confirmed order
 * (see STORE_UPCOMING_STATUSES) whose event falls in the optional half-open
 * eventDate `window` (resolve with istScopeWindow; omit for the whole forward
 * book), nearest event first, so the store can pre-arrange stock.
 * `requisitionRaised` flags whether the chef has already put the order into
 * the store's requisition queue — what's actionable now vs. still coming.
 * Gated on READ_ROLES (STORE_KEEPER included), mirroring listOrders.
 */
export async function listUpcomingOrdersForStore(window?: DateWindow) {
  await requireRole(READ_ROLES);
  const rows = await db.order.findMany({
    where: {
      status: { in: STORE_UPCOMING_STATUSES },
      ...(window ? { eventDate: { gte: window.from, lt: window.toExclusive } } : {}),
    },
    select: {
      id: true,
      code: true,
      channel: true,
      status: true,
      headcount: true,
      eventDate: true,
      customer: { select: { name: true } },
      // A live (non-cancelled) requisition means it's already in the store's
      // queue — one is enough to answer the boolean.
      chefRequisitions: {
        where: { status: { not: ChefRequisitionStatus.CANCELLED } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { eventDate: "asc" },
    take: 100,
  });
  return rows.map((o) => ({
    id: o.id,
    code: o.code,
    channel: o.channel,
    status: o.status,
    headcount: o.headcount,
    eventDate: o.eventDate.toISOString(),
    customerName: o.customer.name,
    requisitionRaised: o.chefRequisitions.length > 0,
  }));
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
      orderRevisions: {
        include: { revisedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      // Named serving staff the F&B team allocated to run the event —
      // rendered as chips in the "Serving staff" section.
      staffAllocations: {
        select: { id: true, staffName: true, duty: true },
        orderBy: { createdAt: "asc" },
      },
      // Leftovers returned from a counter-sale / ODC event — rendered as
      // chips in the "Leftovers returned" section (that channel only).
      leftoverReturns: {
        select: { id: true, itemName: true, quantity: true, unit: true, disposition: true, note: true },
        orderBy: { createdAt: "asc" },
      },
      // Per-dish kitchen → delivery handover state (an order has at most
      // one production job). Lean select: only what the handover checklist
      // + accountability timeline need.
      productionJobs: {
        select: {
          id: true,
          items: {
            select: {
              id: true,
              status: true,
              portions: true,
              handedOverAt: true,
              dish: { select: { name: true } },
              handedOverBy: { select: { name: true } },
            },
          },
        },
        take: 1,
      },
    },
  });
}
