"use server";

/**
 * Ending an order. Cancel (and unwind everything open against it), force-deliver,
 * close after payment, mark an in-house order served, and hand the customer's feedback
 * to someone.
 */

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import {
  BanquetRequisitionStatus,
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  CustomerInvoiceStatus,
  DeliveryStatus,
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
import { ORDER_MANAGER_ROLES, requireRole } from "@/server/rbac";
import { FORCE_DELIVERABLE_ORDER_STATUSES, STATUS_LABEL } from "@/lib/order-status";
import { ActionError, actionFailure, type ActionResult, type ActionResultWith } from "@/server/action-result";
import { sha256Json } from "@/lib/audit";
import { formatINR, toDecimal } from "@/lib/money";
import { EXCLUDE_PROFORMA } from "@/lib/invoice-kinds";
import { isImmediateChannel, channelWantsFeedback } from "@/lib/order-channels";
import { createNotification, notifyRoles } from "@/server/notification-core";
import { deferAfterResponse } from "@/server/defer";
import { cancelBanquetRequisitionsWithPOs } from "@/server/banquet-core";

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

    // A live customer invoice is the customer's own copy of this event.
    // Cancel the order out from under one and the books carry a bill for
    // something that never happened — so the invoice goes first.
    // cancelCustomerInvoice is the way out: it hands the order back at
    // DELIVERED, and it is the only path that also settles a live IRN with
    // the GSP. Proformas are excluded — an estimate auto-raised on chef
    // approval, which every accepted order carries (lib/invoice-kinds.ts).
    const billed = await tx.customerInvoice.findFirst({
      where: {
        ...EXCLUDE_PROFORMA,
        status: { not: CustomerInvoiceStatus.CANCELLED },
        // Directly billed, or a member of a consolidated in-house folio.
        OR: [{ orderId: id }, { consolidatedOrders: { some: { id } } }],
      },
      select: { invoiceNo: true, amountPaid: true },
      orderBy: { createdAt: "desc" },
    });
    if (billed) {
      // amountPaid, not the status: cash taken at the door is credited onto
      // the DRAFT invoice, which no status check would catch.
      throw new ActionError(
        toDecimal(billed.amountPaid).gt(0)
          ? `${formatINR(billed.amountPaid)} has been collected against invoice ${billed.invoiceNo} — reverse the payments and cancel that invoice first, then cancel the order.`
          : `Invoice ${billed.invoiceNo} is still live against this order — cancel it first (that returns the order to Delivered), then cancel the order.`,
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
