"use server";

import { CustomerInvoiceStatus, DeliveryStatus, OrderStatus, Role } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { hasRole, requireSession } from "@/server/rbac";
import { toDecimal } from "@/lib/money";

/**
 * Returns the 4 dashboard KPIs and a role-aware "my queue" count.
 *
 * Tiles:
 *   - todayOrders         orders whose eventDate is between today 00:00 IST
 *                         and tomorrow 00:00 IST.
 *   - todayDeliveries     deliveries scheduled today, not yet DELIVERED/FAILED.
 *   - outstandingAR       sum of (grandTotal - amountPaid) over ISSUED+PARTIAL
 *                         customer invoices.
 *   - lowStockCount       ingredients with onHandQty <= reorderLevel and active.
 *
 * Plus a `myQueue` { count, label, href } block driven by the caller's role:
 *   STORE_KEEPER         → PENDING_STORE_APPROVAL → /queue/store-approvals
 *   MANAGER              → PENDING_MANAGER_APPROVAL + REJECTED_BY_STORE → /queue/manager-approvals
 *   KITCHEN_HEAD         → READY_FOR_PRODUCTION + IN_PREP → /kitchen
 *   SALES                → DRAFT orders → /orders?filter=draft
 *   DELIVERY             → SCHEDULED + DISPATCHED for self → /deliveries
 *   ACCOUNTS / ADMIN     → ISSUED invoices outstanding → /payments/receivables
 */
export async function getDashboardSummary() {
  const session = await requireSession();
  const userId = session.user.id;

  // Today 00:00 IST -> tomorrow 00:00 IST. We approximate via UTC since the
  // tile is for human consumption; the IST conversion can drift up to 5.5h
  // around the boundary, acceptable for a dashboard KPI.
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const [todayOrders, todayDeliveries, openInvoices, lowStockIngredients] = await Promise.all([
    db.order.count({
      where: {
        eventDate: { gte: todayStart, lt: tomorrowStart },
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED_BY_MANAGER, OrderStatus.REJECTED_BY_STORE] },
      },
    }),
    db.delivery.count({
      where: {
        scheduledAt: { gte: todayStart, lt: tomorrowStart },
        status: { notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED, DeliveryStatus.CANCELLED] },
      },
    }),
    db.customerInvoice.findMany({
      where: { status: { in: [CustomerInvoiceStatus.ISSUED, CustomerInvoiceStatus.PARTIAL] } },
      select: { grandTotal: true, amountPaid: true },
    }),
    db.ingredient.findMany({
      where: { active: true },
      select: { onHandQty: true, reorderLevel: true },
    }),
  ]);

  const outstandingAR = openInvoices
    .reduce((s, inv) => s.plus(toDecimal(inv.grandTotal).minus(toDecimal(inv.amountPaid))), new Decimal(0))
    .toDecimalPlaces(2);
  const lowStockCount = lowStockIngredients
    .filter((i) => toDecimal(i.onHandQty).lte(toDecimal(i.reorderLevel)))
    .length;

  // ─── My queue ─────────────────────────────────────────────────────────
  let myQueue: { count: number; label: string; href: string } | null = null;
  if (hasRole(session, [Role.STORE_KEEPER])) {
    const c = await db.order.count({ where: { status: OrderStatus.PENDING_STORE_APPROVAL } });
    myQueue = { count: c, label: "Awaiting store approval", href: "/queue/store-approvals" };
  } else if (hasRole(session, [Role.MANAGER])) {
    const c = await db.order.count({
      where: { status: { in: [OrderStatus.PENDING_MANAGER_APPROVAL, OrderStatus.REJECTED_BY_STORE] } },
    });
    myQueue = { count: c, label: "Awaiting manager approval", href: "/queue/manager-approvals" };
  } else if (hasRole(session, [Role.KITCHEN_HEAD])) {
    const c = await db.order.count({
      where: {
        status: {
          in: [OrderStatus.CHEF_REQUISITION_PENDING, OrderStatus.READY_FOR_PRODUCTION, OrderStatus.IN_PREP],
        },
      },
    });
    myQueue = { count: c, label: "Kitchen workload", href: "/kitchen" };
  } else if (hasRole(session, [Role.SALES])) {
    const c = await db.order.count({ where: { status: OrderStatus.DRAFT, createdById: userId } });
    myQueue = { count: c, label: "My draft orders", href: "/orders?filter=draft" };
  } else if (hasRole(session, [Role.DELIVERY])) {
    const c = await db.delivery.count({
      where: {
        driverUserId: userId,
        status: { in: [DeliveryStatus.SCHEDULED, DeliveryStatus.DISPATCHED, DeliveryStatus.IN_TRANSIT] },
      },
    });
    myQueue = { count: c, label: "My deliveries", href: "/deliveries" };
  } else if (hasRole(session, [Role.ACCOUNTS, Role.ADMIN])) {
    const c = openInvoices.length;
    myQueue = { count: c, label: "Open invoices", href: "/payments/receivables" };
  }

  return {
    todayOrders,
    todayDeliveries,
    outstandingAR: outstandingAR.toString(),
    lowStockCount,
    myQueue,
  };
}
