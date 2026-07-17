"use server";

import { revalidatePath } from "next/cache";
import { OrderChannel, Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import { OrderLeftoverInput } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";

// Who may log / remove leftover returns: management plus the two
// front-of-house teams that run the counter / event — same set that
// allocates serving staff.
const LEFTOVER_EDIT_ROLES = [Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY];

// Anyone who can open an order view can see its leftovers — same broad
// read set as orders.ts READ_ROLES.
const LEFTOVER_READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS,
  Role.DELIVERY, Role.FNB_SERVICE,
];

/**
 * Log a leftover returned from a counter-sale / ODC event (cake, juice,
 * chips…) and where it went. Traceability only — this posts no stock
 * movement. The same item can be logged more than once (different
 * dispositions), so there's no duplicate-name refusal.
 */
export async function addOrderLeftover(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await addOrderLeftoverInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function addOrderLeftoverInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(LEFTOVER_EDIT_ROLES);
  const input = OrderLeftoverInput.parse(raw);

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, channel: true },
  });
  if (!order) throw new ActionError("Order not found");
  // Returns only make sense for the walk-up counter and outdoor catering —
  // those are the channels where surplus food comes back after the event.
  if (order.channel !== OrderChannel.COUNTER_SALE && order.channel !== OrderChannel.ODC) {
    throw new ActionError("Leftover returns apply only to counter-sale and ODC orders.");
  }

  const itemName = input.itemName.trim();
  const row = await db.orderLeftoverReturn.create({
    data: {
      orderId: order.id,
      itemName,
      quantity: input.quantity,
      unit: input.unit.trim(),
      disposition: input.disposition,
      note: input.note?.trim() || null,
      recordedById: session.user.id,
    },
  });
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ORDER_LEFTOVER_RETURNED",
      entity: "Order",
      entityId: order.id,
      payloadHash: sha256Json({ itemName, quantity: input.quantity }),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/orders/${order.id}`);
  return { ok: true, id: row.id };
}

/**
 * Remove a logged leftover entry. Reversible (just re-log it), so no
 * confirmation dance — but still audit-logged.
 */
export async function removeOrderLeftover(id: string): Promise<ActionResult> {
  try {
    return await removeOrderLeftoverInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function removeOrderLeftoverInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(LEFTOVER_EDIT_ROLES);
  const row = await db.orderLeftoverReturn.findUnique({
    where: { id },
    select: { id: true, orderId: true, itemName: true, quantity: true },
  });
  if (!row) throw new ActionError("That leftover entry no longer exists — refresh and try again.");

  await db.orderLeftoverReturn.delete({ where: { id } });
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ORDER_LEFTOVER_REMOVED",
      entity: "Order",
      entityId: row.orderId,
      payloadHash: sha256Json({ itemName: row.itemName, quantity: row.quantity.toString() }),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/orders/${row.orderId}`);
  return { ok: true };
}

/** Leftovers logged against an order, oldest first (log order). */
export async function listOrderLeftovers(orderId: string) {
  await requireRole(LEFTOVER_READ_ROLES);
  return db.orderLeftoverReturn.findMany({
    where: { orderId },
    select: { id: true, itemName: true, quantity: true, unit: true, disposition: true, note: true },
    orderBy: { createdAt: "asc" },
  });
}
