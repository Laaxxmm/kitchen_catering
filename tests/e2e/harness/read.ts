import { db } from "@/server/db";

/**
 * Read state back out of the database rather than trusting what an action
 * returned. Thin on purpose — these exist so a scenario reads as a sequence
 * of business steps, not as thirty lines of Prisma includes.
 */

export async function orderStatus(orderId: string) {
  const row = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true },
  });
  return row.status;
}

export async function order(orderId: string) {
  return db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function requisition(requisitionId: string) {
  return db.chefRequisition.findUniqueOrThrow({
    where: { id: requisitionId },
    include: {
      lines: { include: { ingredient: { select: { sku: true, name: true } } } },
    },
  });
}

/** One requisition line, found by the ingredient it asks for. */
export async function requisitionLine(requisitionId: string, ingredientId: string) {
  return db.chefRequisitionLine.findFirstOrThrow({
    where: { requisitionId, ingredientId },
  });
}

export async function onHand(ingredientId: string): Promise<string> {
  const row = await db.ingredient.findUniqueOrThrow({
    where: { id: ingredientId },
    select: { onHandQty: true },
  });
  return row.onHandQty.toString();
}

export async function invoice(invoiceId: string) {
  return db.customerInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

/** The one non-cancelled tax invoice for an order, or null. */
export async function taxInvoiceForOrder(orderId: string) {
  return db.customerInvoice.findFirst({
    where: { orderId, kind: "ORDER", status: { not: "CANCELLED" } },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function purchaseOrder(poId: string) {
  return db.vendorPO.findUniqueOrThrow({
    where: { id: poId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function vendorBill(billId: string) {
  return db.vendorBill.findUniqueOrThrow({
    where: { id: billId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, payments: true },
  });
}

export async function delivery(deliveryId: string) {
  return db.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

export async function productionJob(orderId: string) {
  return db.productionJob.findFirst({
    where: { orderId },
    include: { items: true },
  });
}

/** Audit rows for one entity, oldest first — proof an action recorded itself. */
export async function auditActions(entity: string, entityId: string): Promise<string[]> {
  const rows = await db.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { at: "asc" },
    select: { action: true },
  });
  return rows.map((r) => r.action);
}
