"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import { OrderStaffInput } from "@/lib/validators";
import { INACTIVE_ORDER_STATUSES } from "@/lib/order-status";
import { sha256Json } from "@/lib/audit";

// Who may allocate / remove serving staff on an event order: management
// plus the two front-of-house teams that actually run the event.
const STAFF_EDIT_ROLES = [Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY];

// Anyone who can open an order view can see who's serving it — same broad
// read set as orders.ts READ_ROLES (chef / store / accounts included).
const STAFF_READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS,
  Role.DELIVERY, Role.FNB_SERVICE,
];

/**
 * Allocate a named serving-staff member to an event order. The F&B team
 * does this once the kitchen posts the order ready (but it's allowed across
 * the whole live window — crews are often lined up ahead of the event).
 * Duplicate names on the same order are refused case-insensitively.
 */
export async function addOrderStaff(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await addOrderStaffInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function addOrderStaffInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(STAFF_EDIT_ROLES);
  const input = OrderStaffInput.parse(raw);
  const staffName = input.staffName.trim();
  const duty = input.duty?.trim() || null;

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      code: true,
      status: true,
      staffAllocations: { select: { staffName: true } },
    },
  });
  if (!order) throw new ActionError("Order not found");
  // Terminal orders (cancelled / rejected / completed) never need a crew.
  if (INACTIVE_ORDER_STATUSES.includes(order.status)) {
    throw new ActionError(
      `Order ${order.code} is ${order.status} — staff can't be allocated to it.`,
    );
  }
  const dup = order.staffAllocations.some(
    (a) => a.staffName.trim().toLowerCase() === staffName.toLowerCase(),
  );
  if (dup) throw new ActionError(`${staffName} is already allocated to this order`);

  const row = await db.orderStaffAllocation.create({
    data: {
      orderId: order.id,
      staffName,
      duty,
      allocatedById: session.user.id,
    },
  });
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ORDER_STAFF_ALLOCATED",
      entity: "Order",
      entityId: order.id,
      payloadHash: sha256Json({ staffName }),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/orders/${order.id}`);
  return { ok: true, id: row.id };
}

/**
 * Remove an allocated staff member from an order. Reversible (just re-add
 * the name), so no confirmation dance — but still audit-logged.
 */
export async function removeOrderStaff(id: string): Promise<ActionResult> {
  try {
    return await removeOrderStaffInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function removeOrderStaffInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(STAFF_EDIT_ROLES);
  const row = await db.orderStaffAllocation.findUnique({
    where: { id },
    select: { id: true, orderId: true, staffName: true },
  });
  if (!row) throw new ActionError("That staff allocation no longer exists — refresh and try again.");

  await db.orderStaffAllocation.delete({ where: { id } });
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ORDER_STAFF_REMOVED",
      entity: "Order",
      entityId: row.orderId,
      payloadHash: sha256Json({ staffName: row.staffName }),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/orders/${row.orderId}`);
  return { ok: true };
}

/** Serving staff allocated to an order, oldest first (allocation order). */
export async function listOrderStaff(orderId: string) {
  await requireRole(STAFF_READ_ROLES);
  return db.orderStaffAllocation.findMany({
    where: { orderId },
    select: { id: true, staffName: true, duty: true },
    orderBy: { createdAt: "asc" },
  });
}
