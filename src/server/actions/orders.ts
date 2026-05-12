"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { ApprovalDecision, OrderStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
import {
  AuthorizationError,
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
import { nextOrderCode } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";

const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS, Role.DELIVERY,
];

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

export async function createOrder(raw: unknown) {
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
    const contractValue = itemsData
      .reduce((s, it) => s.plus(new Decimal(it.lineTotal)), new Decimal(0))
      .toDecimalPlaces(2);

    const created = await tx.order.create({
      data: {
        code,
        customerId: input.customerId,
        eventDate: new Date(input.eventDate),
        headcount: input.headcount,
        mealType: input.mealType,
        deliveryAddress: input.deliveryAddress,
        deliveryWindowStart: new Date(input.deliveryWindowStart),
        deliveryWindowEnd: new Date(input.deliveryWindowEnd),
        placeOfSupplyStateCode: input.placeOfSupplyStateCode,
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
  return { id: order.id, code: order.code };
}

export async function updateOrderDraft(id: string, raw: unknown) {
  const session = await requireRole(ORDER_SALES_ROLES);
  const input = OrderUpdateInput.parse(raw);

  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.DRAFT) {
      throw new AuthorizationError("Only DRAFT orders can be edited");
    }

    // Header fields
    const data: Record<string, unknown> = {};
    if (input.customerId) data.customerId = input.customerId;
    if (input.eventDate) data.eventDate = new Date(input.eventDate);
    if (input.headcount) data.headcount = input.headcount;
    if (input.mealType) data.mealType = input.mealType;
    if (input.deliveryAddress) data.deliveryAddress = input.deliveryAddress;
    if (input.deliveryWindowStart) data.deliveryWindowStart = new Date(input.deliveryWindowStart);
    if (input.deliveryWindowEnd) data.deliveryWindowEnd = new Date(input.deliveryWindowEnd);
    if (input.placeOfSupplyStateCode) data.placeOfSupplyStateCode = input.placeOfSupplyStateCode;
    if (input.notes !== undefined) data.notes = input.notes;

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
      data.contractValue = itemsData
        .reduce((s, it) => s.plus(new Decimal(it.lineTotal)), new Decimal(0))
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
}

/**
 * Submit a DRAFT order. Workflow v2: goes straight to the CHEF for
 * feasibility approval (no separate store-approval step). The chef can
 * either confirm or propose changes (which then need manager OK).
 */
export async function submitOrder(id: string) {
  const session = await requireRole(ORDER_SALES_ROLES);

  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.DRAFT) {
      throw new AuthorizationError("Only DRAFT orders can be submitted");
    }
    if (order.items.length === 0) throw new Error("Add at least one item before submitting");
    if (order.eventDate.getTime() <= Date.now()) {
      throw new Error("Event date must be in the future");
    }
    if (!order.deliveryAddress.trim()) throw new Error("Delivery address is required");

    await tx.order.update({
      where: { id },
      data: {
        status: OrderStatus.PENDING_CHEF_APPROVAL,
        submittedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_SUBMITTED",
        entity: "Order",
        entityId: id,
        payloadHash: sha256Json({ from: order.status, to: OrderStatus.PENDING_CHEF_APPROVAL }),
      },
    });
  });

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath("/queue/chef-approvals");
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
) {
  const session = await requireRole(ORDER_KITCHEN_ROLES);
  if (!input.note?.trim()) throw new Error("A note is required");

  let triggerProforma = false;

  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.PENDING_CHEF_APPROVAL) {
      throw new AuthorizationError("Order is not awaiting chef approval");
    }

    const nextStatus =
      input.decision === "APPROVED"
        ? OrderStatus.CHEF_REQUISITION_PENDING
        : OrderStatus.CHANGES_PROPOSED_BY_CHEF;

    await tx.order.update({
      where: { id },
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

  // Auto-create + email the proforma invoice OUTSIDE the transaction so
  // a slow SMTP / PDF render doesn't hold a row lock.
  if (triggerProforma) {
    const { createProformaInvoiceForOrder } = await import("./customer-invoices");
    try {
      await createProformaInvoiceForOrder(id);
    } catch (err) {
      console.error(`[proforma] order ${id} failed:`, err);
    }
  }
}

/**
 * Manager reviews the chef's proposed changes. Two outcomes:
 *   - APPROVED → advances straight to CHEF_REQUISITION_PENDING (per the
 *                product decision: chef doesn't re-confirm, manager OK is
 *                enough). Auto-creates + emails the proforma.
 *   - REJECTED → REJECTED_BY_MANAGER (terminal).
 *
 * Only callable from CHANGES_PROPOSED_BY_CHEF.
 */
export async function managerApproveChefSuggestion(
  id: string,
  input: { decision: "APPROVED" | "REJECTED"; note?: string },
) {
  const session = await requireRole(ORDER_MANAGER_ROLES);

  let triggerProforma = false;

  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.CHANGES_PROPOSED_BY_CHEF) {
      throw new AuthorizationError("Order does not have pending chef-proposed changes");
    }
    const nextStatus =
      input.decision === "APPROVED"
        ? OrderStatus.CHEF_REQUISITION_PENDING
        : OrderStatus.REJECTED_BY_MANAGER;

    await tx.order.update({
      where: { id },
      data: {
        status: nextStatus,
        managerChangeReviewedById: session.user.id,
        managerChangeReviewedAt: new Date(),
        managerChangeDecision:
          input.decision === "APPROVED" ? ApprovalDecision.APPROVED : ApprovalDecision.REJECTED,
        managerChangeNote: input.note ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: input.decision === "APPROVED" ? "ORDER_MANAGER_APPROVED_CHANGES" : "ORDER_MANAGER_REJECTED_CHANGES",
        entity: "Order",
        entityId: id,
        payloadHash: sha256Json({ decision: input.decision, note: input.note ?? null }),
      },
    });
    if (input.decision === "APPROVED") {
      triggerProforma = true;
    }
  });

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath("/queue/manager-approvals");

  if (triggerProforma) {
    const { createProformaInvoiceForOrder } = await import("./customer-invoices");
    try {
      await createProformaInvoiceForOrder(id);
    } catch (err) {
      console.error(`[proforma] order ${id} failed:`, err);
    }
  }
}

// =====================================================================
// LEGACY TWO-STAGE APPROVAL (workflow v1 — kept for reference)
// New orders never see PENDING_STORE_APPROVAL; these actions remain to
// process any in-flight v1 orders cleanly. Safe to delete in a future
// migration once there's confidence nothing references them.
// =====================================================================

export async function storeApproveOrder(id: string, raw: unknown) {
  const session = await requireRole(ORDER_STORE_ROLES);
  const input = OrderStoreApprovalInput.parse(raw);

  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.PENDING_STORE_APPROVAL) {
      throw new AuthorizationError("Order is not awaiting store approval");
    }

    const nextStatus =
      input.decision === "APPROVED"
        ? OrderStatus.PENDING_MANAGER_APPROVAL
        : OrderStatus.REJECTED_BY_STORE;

    await tx.order.update({
      where: { id },
      data: {
        status: nextStatus,
        storeReviewedById: session.user.id,
        storeReviewedAt: new Date(),
        storeDecision: input.decision === "APPROVED" ? ApprovalDecision.APPROVED : ApprovalDecision.REJECTED,
        storeApprovalNote: input.note,
      },
    });
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
}

export async function managerApproveOrder(id: string, raw: unknown) {
  const session = await requireRole(ORDER_MANAGER_ROLES);
  const input = OrderManagerApprovalInput.parse(raw);

  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.PENDING_MANAGER_APPROVAL) {
      throw new AuthorizationError("Order is not awaiting manager approval");
    }

    const nextStatus =
      input.decision === "APPROVED"
        ? OrderStatus.CHEF_REQUISITION_PENDING
        : OrderStatus.REJECTED_BY_MANAGER;

    await tx.order.update({
      where: { id },
      data: {
        status: nextStatus,
        managerReviewedById: session.user.id,
        managerReviewedAt: new Date(),
        managerDecision:
          input.decision === "APPROVED" ? ApprovalDecision.APPROVED : ApprovalDecision.REJECTED,
        managerApprovalNote: input.note ?? null,
      },
    });
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
}

export async function managerOverrideStoreRejection(id: string, raw: unknown) {
  const session = await requireRole(ORDER_MANAGER_ROLES);
  const input = OrderManagerOverrideInput.parse(raw);

  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.REJECTED_BY_STORE) {
      throw new AuthorizationError("Only store-rejected orders can be overridden");
    }
    await tx.order.update({
      where: { id },
      data: {
        status: OrderStatus.CHEF_REQUISITION_PENDING,
        managerReviewedById: session.user.id,
        managerReviewedAt: new Date(),
        managerDecision: ApprovalDecision.OVERRIDDEN,
        managerOverrideReason: input.reason,
      },
    });
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
}

export async function cancelOrder(id: string, reason: string) {
  const session = await requireRole(ORDER_MANAGER_ROLES);
  if (!reason.trim()) throw new Error("Cancellation reason is required");

  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new Error("Order not found");
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.COMPLETED) {
      throw new Error(`Order is already ${order.status}`);
    }
    await tx.order.update({
      where: { id },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: reason },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_CANCELLED",
        entity: "Order",
        entityId: id,
        payloadHash: sha256Json({ reason }),
      },
    });
  });

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
}

export async function assignKitchenSupervisor(id: string, userId: string) {
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

  return db.order.findMany({
    where: {
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
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
      chefRequisitions: { select: { id: true, requisitionNo: true, status: true } },
    },
  });
}
