"use server";

/**
 * The approval chain. Admin sign-off on the commercials, the chef's feasibility
 * call (accept / propose changes / swap a dish), the manager ruling on those changes,
 * and the legacy store/manager gates the v1 flow still carries.
 */

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { ApprovalDecision, OrderStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
import { ORDER_KITCHEN_ROLES, ORDER_MANAGER_ROLES, ORDER_STORE_ROLES, requireRole } from "@/server/rbac";
import { OrderManagerApprovalInput, OrderManagerOverrideInput, OrderStoreApprovalInput } from "@/lib/validators";
import { STATUS_LABEL } from "@/lib/order-status";
import { ActionError, actionFailure, type ActionResult } from "@/server/action-result";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { isEventDeliveryChannel, isPackagePricedChannel } from "@/lib/order-channels";
import { createNotification, notifyRoles } from "@/server/notification-core";
import { deferAfterResponse } from "@/server/defer";
import { formatIST } from "@/lib/time";
import { computeLine, notifyOrderToChef } from "./_shared";

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
