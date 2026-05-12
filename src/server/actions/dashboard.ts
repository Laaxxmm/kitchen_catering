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
 *   STORE_KEEPER         → CHEF_REQUISITION_PENDING + READY_FOR_ISSUE → /queue/issuing
 *   MANAGER              → CHANGES_PROPOSED_BY_CHEF → /queue/manager-approvals
 *   KITCHEN_HEAD         → PENDING_CHEF_APPROVAL + production → /queue/chef-approvals
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
    const c = await db.order.count({
      where: { status: { in: [OrderStatus.CHEF_REQUISITION_PENDING, OrderStatus.ISSUING] } },
    });
    myQueue = { count: c, label: "Awaiting issuing", href: "/queue/issuing" };
  } else if (hasRole(session, [Role.MANAGER])) {
    const c = await db.order.count({
      where: { status: OrderStatus.CHANGES_PROPOSED_BY_CHEF },
    });
    myQueue = { count: c, label: "Chef-suggested changes", href: "/queue/manager-approvals" };
  } else if (hasRole(session, [Role.KITCHEN_HEAD])) {
    const c = await db.order.count({
      where: {
        status: {
          in: [OrderStatus.PENDING_CHEF_APPROVAL, OrderStatus.READY_FOR_PRODUCTION, OrderStatus.IN_PREP],
        },
      },
    });
    myQueue = { count: c, label: "Chef work queue", href: "/queue/chef-approvals" };
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

  // ─── AR breakdown for admin/manager/accounts ─────────────────────────
  // - collectedThisMonth: sum of CustomerInvoicePayment.amount (non-reversed)
  //   whose paidAt falls inside the current calendar month.
  // - pending: sum of (grandTotal - amountPaid) over ISSUED+PARTIAL invoices
  //   (same as outstandingAR above; surfaced explicitly for clarity).
  // - overdue: same outstanding measure restricted to dueAt < now.
  let ar: { collectedThisMonth: string; pending: string; overdue: string } | null = null;
  if (hasRole(session, [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS])) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthPayments = await db.customerInvoicePayment.findMany({
      where: { paidAt: { gte: monthStart, lt: monthEnd }, reversedAt: null },
      select: { amount: true },
    });
    const collected = monthPayments
      .reduce((s, p) => s.plus(toDecimal(p.amount)), new Decimal(0))
      .toDecimalPlaces(2);

    const overdueInvoices = await db.customerInvoice.findMany({
      where: {
        status: { in: [CustomerInvoiceStatus.ISSUED, CustomerInvoiceStatus.PARTIAL] },
        dueAt: { lt: now },
      },
      select: { grandTotal: true, amountPaid: true },
    });
    const overdue = overdueInvoices
      .reduce((s, inv) => s.plus(toDecimal(inv.grandTotal).minus(toDecimal(inv.amountPaid))), new Decimal(0))
      .toDecimalPlaces(2);

    ar = {
      collectedThisMonth: collected.toString(),
      pending: outstandingAR.toString(),
      overdue: overdue.toString(),
    };
  }

  // ─── Live orders by stage (admin/manager) ────────────────────────────
  // Counts active orders bucketed into the happy-path stages so the dashboard
  // can render a "where is the work right now" view.
  let stageCounts: Record<string, number> | null = null;
  if (hasRole(session, [Role.ADMIN, Role.MANAGER])) {
    const STAGE_STATUSES: OrderStatus[] = [
      OrderStatus.DRAFT,
      OrderStatus.PENDING_CHEF_APPROVAL,
      OrderStatus.CHANGES_PROPOSED_BY_CHEF,
      OrderStatus.CHEF_REQUISITION_PENDING,
      OrderStatus.ISSUING,
      OrderStatus.ISSUING,
      OrderStatus.READY_FOR_PRODUCTION,
      OrderStatus.IN_PREP,
      OrderStatus.READY,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.INVOICED,
    ];
    const rows = await db.order.groupBy({
      by: ["status"],
      where: { status: { in: STAGE_STATUSES } },
      _count: { _all: true },
    });
    stageCounts = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  return {
    todayOrders,
    todayDeliveries,
    outstandingAR: outstandingAR.toString(),
    lowStockCount,
    myQueue,
    ar,
    stageCounts,
  };
}
