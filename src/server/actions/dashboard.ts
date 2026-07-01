"use server";

import {
  ChefRequisitionStatus,
  CustomerInvoiceStatus,
  DeliveryStatus,
  GRNStatus,
  OrderStatus,
  ProductionJobStatus,
  Role,
  VendorBillStatus,
  VendorPOStatus,
} from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { hasRole, requireSession } from "@/server/rbac";
import { toDecimal } from "@/lib/money";
import { INACTIVE_ORDER_STATUSES } from "@/lib/order-status";

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

  const [todayOrders, dueOrders, todayDeliveries, deliveredToday, openInvoices, lowStockIngredients] = await Promise.all([
    db.order.count({
      where: {
        eventDate: { gte: todayStart, lt: tomorrowStart },
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED_BY_MANAGER, OrderStatus.REJECTED_BY_STORE] },
      },
    }),
    // Total *open* orders — everything still in the pipeline, regardless of
    // date. Drives the "due" count on the Orders launcher tile (the team
    // wants the full backlog, not just today's). Closed = paid / completed /
    // cancelled / rejected.
    db.order.count({
      where: {
        status: {
          notIn: [
            OrderStatus.PAID,
            OrderStatus.COMPLETED,
            OrderStatus.CANCELLED,
            OrderStatus.REJECTED_BY_MANAGER,
            OrderStatus.REJECTED_BY_ADMIN,
            OrderStatus.REJECTED_BY_STORE,
          ],
        },
      },
    }),
    db.delivery.count({
      where: {
        scheduledAt: { gte: todayStart, lt: tomorrowStart },
        status: { notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED, DeliveryStatus.CANCELLED] },
      },
    }),
    // Deliveries actually completed today — drives the "delivered today"
    // launcher tile. Same day window as the other "today" KPIs.
    db.delivery.count({
      where: {
        deliveredAt: { gte: todayStart, lt: tomorrowStart },
        status: DeliveryStatus.DELIVERED,
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
    // The manager now owns the first order-approval gate, plus chef-proposed
    // changes. Surface both as one "needs you" count, pointing at the
    // approvals queue (the more frequent one).
    const c = await db.order.count({
      where: {
        status: {
          in: [OrderStatus.PENDING_ADMIN_APPROVAL, OrderStatus.CHANGES_PROPOSED_BY_CHEF],
        },
      },
    });
    myQueue = { count: c, label: "Orders to approve", href: "/queue/admin-approvals" };
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

  // ─── AP (payables) breakdown for admin/manager/accounts ──────────────
  // - paidThisMonth: VendorBillPayment.amount sum for the current month
  //   (non-reversed).
  // - pending: outstanding (grandTotal - amountPaid) over APPROVED /
  //   MATCHED / OVERDUE / DISCREPANCY bills.
  // - overdue: outstanding restricted to dueDate < now.
  let ap: { paidThisMonth: string; pending: string; overdue: string } | null = null;
  if (hasRole(session, [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS])) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [monthBillPayments, openBills, overdueBills] = await Promise.all([
      db.vendorBillPayment.findMany({
        where: { paidAt: { gte: monthStart, lt: monthEnd }, reversedAt: null },
        select: { amount: true },
      }),
      db.vendorBill.findMany({
        where: {
          status: {
            in: [
              VendorBillStatus.MATCHED,
              VendorBillStatus.APPROVED,
              VendorBillStatus.OVERDUE,
              VendorBillStatus.DISCREPANCY,
            ],
          },
        },
        select: { grandTotal: true, amountPaid: true },
      }),
      db.vendorBill.findMany({
        where: {
          status: {
            in: [VendorBillStatus.MATCHED, VendorBillStatus.APPROVED, VendorBillStatus.OVERDUE],
          },
          dueDate: { lt: now },
        },
        select: { grandTotal: true, amountPaid: true },
      }),
    ]);
    const paid = monthBillPayments
      .reduce((s, p) => s.plus(toDecimal(p.amount)), new Decimal(0))
      .toDecimalPlaces(2);
    const pending = openBills
      .reduce((s, b) => s.plus(toDecimal(b.grandTotal).minus(toDecimal(b.amountPaid))), new Decimal(0))
      .toDecimalPlaces(2);
    const overdueAP = overdueBills
      .reduce((s, b) => s.plus(toDecimal(b.grandTotal).minus(toDecimal(b.amountPaid))), new Decimal(0))
      .toDecimalPlaces(2);
    ap = {
      paidThisMonth: paid.toString(),
      pending: pending.toString(),
      overdue: overdueAP.toString(),
    };
  }

  // ─── Order-status counts (shared) ────────────────────────────────────
  // Single groupBy covers both the admin "stage counts" view and the chef
  // "kitchen pipeline" tiles. Previously this was 6+ separate COUNT calls
  // — one groupBy is dramatically faster on cold caches.
  //
  // We also pull `_min(updatedAt)` so the journey strip can flag any
  // status where an order has been parked for too long ("stuck").
  let stageCounts: Record<string, number> | null = null;
  let stageStuck: Record<string, boolean> | null = null;
  let kitchen: {
    awaitingChefApproval: number;
    requisitionPending: number;
    waitingOnStore: number;
    readyToCook: number;
    inProduction: number;
    readyToDispatch: number;
    /** Admin gate (workflow v3) — populated only for admin/manager views. */
    awaitingAdminApproval?: number;
  } | null = null;
  const needsOrderStatusCounts =
    hasRole(session, [Role.ADMIN, Role.MANAGER]) ||
    hasRole(session, [Role.KITCHEN_HEAD]) ||
    hasRole(session, [Role.STORE_KEEPER]);
  if (needsOrderStatusCounts) {
    const STAGE_STATUSES: OrderStatus[] = [
      OrderStatus.DRAFT,
      OrderStatus.PENDING_ADMIN_APPROVAL,
      OrderStatus.PENDING_CHEF_APPROVAL,
      OrderStatus.CHANGES_PROPOSED_BY_CHEF,
      OrderStatus.CHEF_REQUISITION_PENDING,
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
      _min: { updatedAt: true },
    });
    const m: Record<string, number> = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    // Pre-delivery stages get the strictest "stuck" rule (24h). Once an
    // order is OUT_FOR_DELIVERY or beyond we don't expect the chef to
    // poke at it, so the threshold is much more forgiving.
    const STUCK_AFTER_HOURS: Partial<Record<string, number>> = {
      [OrderStatus.DRAFT]: 48,
      [OrderStatus.PENDING_CHEF_APPROVAL]: 12,
      [OrderStatus.CHANGES_PROPOSED_BY_CHEF]: 12,
      [OrderStatus.CHEF_REQUISITION_PENDING]: 24,
      [OrderStatus.ISSUING]: 24,
      [OrderStatus.READY_FOR_PRODUCTION]: 24,
      [OrderStatus.IN_PREP]: 12,
      [OrderStatus.READY]: 6,
      [OrderStatus.OUT_FOR_DELIVERY]: 6,
      [OrderStatus.DELIVERED]: 72,
      [OrderStatus.INVOICED]: 240, // 10 days — invoicing waits on payment
    };
    const stuck: Record<string, boolean> = {};
    for (const r of rows) {
      if (!r._min.updatedAt) continue;
      const ageHours = (now.getTime() - r._min.updatedAt.getTime()) / (60 * 60 * 1000);
      const limit = STUCK_AFTER_HOURS[r.status] ?? 48;
      if (ageHours > limit) stuck[r.status] = true;
    }
    stageStuck = stuck;
    if (hasRole(session, [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER])) stageCounts = m;
    if (hasRole(session, [Role.KITCHEN_HEAD, Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER])) {
      kitchen = {
        awaitingChefApproval: m[OrderStatus.PENDING_CHEF_APPROVAL] ?? 0,
        requisitionPending: m[OrderStatus.CHEF_REQUISITION_PENDING] ?? 0,
        waitingOnStore: m[OrderStatus.ISSUING] ?? 0,
        readyToCook: m[OrderStatus.READY_FOR_PRODUCTION] ?? 0,
        inProduction: m[OrderStatus.IN_PREP] ?? 0,
        readyToDispatch: m[OrderStatus.READY] ?? 0,
        awaitingAdminApproval: m[OrderStatus.PENDING_ADMIN_APPROVAL] ?? 0,
      };
    }
  }

  // ─── Procurement queue (admin/manager) ───────────────────────────────
  // Three groupBys (one per buy-side table) instead of separate counts;
  // sums folded in code.
  let procurement: {
    poPendingApproval: number;
    poSentNotReceived: number;
    grnPendingBill: number;
    billsPendingMatch: number;
    billsPendingPayment: number;
  } | null = null;
  if (hasRole(session, [Role.ADMIN, Role.MANAGER])) {
    const [poRows, grnRows, billRows] = await Promise.all([
      db.vendorPO.groupBy({ by: ["status"], _count: { _all: true } }),
      db.gRN.groupBy({ by: ["status"], _count: { _all: true } }),
      db.vendorBill.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const po = Object.fromEntries(poRows.map((r) => [r.status, r._count._all]));
    const grn = Object.fromEntries(grnRows.map((r) => [r.status, r._count._all]));
    const bill = Object.fromEntries(billRows.map((r) => [r.status, r._count._all]));
    procurement = {
      poPendingApproval: po[VendorPOStatus.PENDING_APPROVAL] ?? 0,
      poSentNotReceived:
        (po[VendorPOStatus.APPROVED] ?? 0) +
        (po[VendorPOStatus.SENT] ?? 0) +
        (po[VendorPOStatus.PARTIALLY_RECEIVED] ?? 0),
      grnPendingBill:
        (grn[GRNStatus.ACCEPTED] ?? 0) + (grn[GRNStatus.PARTIALLY_ACCEPTED] ?? 0),
      billsPendingMatch:
        (bill[VendorBillStatus.DRAFT] ?? 0) +
        (bill[VendorBillStatus.PENDING_MATCH] ?? 0) +
        (bill[VendorBillStatus.DISCREPANCY] ?? 0),
      billsPendingPayment:
        (bill[VendorBillStatus.MATCHED] ?? 0) +
        (bill[VendorBillStatus.APPROVED] ?? 0) +
        (bill[VendorBillStatus.OVERDUE] ?? 0),
    };
  }

  // ─── Production-job board peek (chef) ────────────────────────────────
  // One groupBy across all production-job statuses.
  let production: { queued: number; prep: number; cooking: number; ready: number } | null = null;
  if (hasRole(session, [Role.KITCHEN_HEAD, Role.ADMIN, Role.MANAGER])) {
    const rows = await db.productionJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const m = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    production = {
      queued: m[ProductionJobStatus.QUEUED] ?? 0,
      prep: m[ProductionJobStatus.PREP] ?? 0,
      cooking: m[ProductionJobStatus.COOKING] ?? 0,
      ready: m[ProductionJobStatus.READY] ?? 0,
    };
  }

  // ─── Driver queue ────────────────────────────────────────────────────
  // The driver's daily worklist: every delivery assigned to them that's
  // still in flight, with the order's customer + delivery address so
  // they can plan their route without clicking through.
  let driver: {
    deliveries: Array<{
      id: string;
      deliveryNo: string;
      status: DeliveryStatus;
      scheduledAt: string;
      vehicleNo: string | null;
      orderCode: string;
      customerName: string;
      deliveryAddress: string;
    }>;
  } | null = null;
  if (hasRole(session, [Role.DELIVERY])) {
    const rows = await db.delivery.findMany({
      where: {
        driverUserId: userId,
        status: {
          in: [DeliveryStatus.SCHEDULED, DeliveryStatus.DISPATCHED, DeliveryStatus.IN_TRANSIT],
        },
      },
      orderBy: { scheduledAt: "asc" },
      take: 50,
      select: {
        id: true,
        deliveryNo: true,
        status: true,
        scheduledAt: true,
        vehicleNo: true,
        order: {
          select: {
            code: true,
            deliveryAddress: true,
            customer: { select: { name: true } },
          },
        },
      },
    });
    driver = {
      deliveries: rows.map((d) => ({
        id: d.id,
        deliveryNo: d.deliveryNo,
        status: d.status,
        scheduledAt: d.scheduledAt.toISOString(),
        vehicleNo: d.vehicleNo,
        orderCode: d.order.code,
        customerName: d.order.customer.name,
        deliveryAddress: d.order.deliveryAddress,
      })),
    };
  }

  // ─── Storekeeper queue ───────────────────────────────────────────────
  // The storekeeper's daily worklist:
  //   - openChefRequisitions: chef raised a requisition, still SUBMITTED
  //     or PARTIALLY_ISSUED. Their main inbox.
  //   - poAwaitingReceipt: vendor POs sent / approved / partially-received
  //     where goods may show up at the door any day.
  //   - lowStock: ingredients at or below reorder level (already counted
  //     above; pass through so the storekeeper sees their own number).
  let storeKeeper: {
    openChefRequisitions: number;
    poAwaitingReceipt: number;
    lowStock: number;
  } | null = null;
  if (hasRole(session, [Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER])) {
    const [openChefRequisitions, poAwaitingReceipt] = await Promise.all([
      db.chefRequisition.count({
        where: {
          status: {
            in: [ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED],
          },
          // Don't count requisitions for cancelled / rejected / completed orders.
          order: { status: { notIn: INACTIVE_ORDER_STATUSES } },
        },
      }),
      db.vendorPO.count({
        where: {
          status: {
            in: [VendorPOStatus.APPROVED, VendorPOStatus.SENT, VendorPOStatus.PARTIALLY_RECEIVED],
          },
        },
      }),
    ]);
    storeKeeper = { openChefRequisitions, poAwaitingReceipt, lowStock: lowStockCount };
  }

  // ─── Today's orders (for the visual timeline) ─────────────────────
  // Lightweight list — only what the timeline needs to render. Capped at
  // 50 so we don't pull the world; today never has more than a handful.
  const todayOrdersList = await db.order.findMany({
    where: {
      eventDate: { gte: todayStart, lt: tomorrowStart },
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED_BY_MANAGER, OrderStatus.REJECTED_BY_STORE] },
    },
    select: {
      id: true,
      code: true,
      status: true,
      eventDate: true,
      mealType: true,
      customer: { select: { name: true } },
    },
    orderBy: { eventDate: "asc" },
    take: 50,
  });

  return {
    todayOrders,
    dueOrders,
    todayDeliveries,
    deliveredToday,
    outstandingAR: outstandingAR.toString(),
    lowStockCount,
    myQueue,
    ar,
    ap,
    stageCounts,
    stageStuck,
    procurement,
    storeKeeper,
    driver,
    kitchen,
    production,
    todayOrdersList: todayOrdersList.map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      eventDate: o.eventDate.toISOString(),
      mealType: o.mealType,
      customerName: o.customer.name,
    })),
  };
}

/**
 * Orders waiting on the store to finish issuing ingredients (status ISSUING
 * or CHEF_REQUISITION_PENDING). Returned with the unfulfilled lines so the
 * chef can see exactly what's blocking each order without clicking into it.
 *
 * Used by the kitchen board's "Coming up" panel and by the chef order
 * detail "What's blocking this order?" block.
 */
export async function getOrdersWaitingOnIngredients(limit = 8) {
  await requireSession();
  const orders = await db.order.findMany({
    where: {
      status: { in: [OrderStatus.CHEF_REQUISITION_PENDING, OrderStatus.ISSUING] },
    },
    orderBy: { eventDate: "asc" },
    take: limit,
    select: {
      id: true,
      code: true,
      status: true,
      eventDate: true,
      customer: { select: { name: true } },
      chefRequisitions: {
        where: { status: { in: [ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED] } },
        select: {
          id: true,
          requisitionNo: true,
          status: true,
          lines: {
            where: { status: { not: "ISSUED" } },
            select: {
              ingredient: { select: { name: true, unit: true } },
              requestedQty: true,
              issuedQty: true,
              status: true,
            },
          },
        },
      },
    },
  });
  return orders;
}
