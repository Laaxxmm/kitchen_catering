"use server";

import {
  CustomerInvoiceStatus,
  ChefRequisitionStatus,
  OrderStatus,
  Role,
  VendorBillStatus,
  VendorPOStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import { hasRole, requireSession } from "@/server/rbac";
import { toDecimal } from "@/lib/money";
import { INACTIVE_ORDER_STATUSES } from "@/lib/order-status";
import type { NavBadges } from "@/lib/nav-config";

/**
 * Per-group "needs you" badges for the sidebar. Only computed for
 * admin/manager (the roles that see every group); other roles have small,
 * focused navs that don't need badges. All counts come from existing data —
 * nothing is hardcoded. Zero counts are omitted so no badge renders.
 */
export async function getNavBadges(): Promise<NavBadges> {
  const session = await requireSession();
  if (!hasRole(session, [Role.ADMIN, Role.MANAGER])) return {};
  const now = new Date();

  const [pendingOrders, openReqs, ingredients, poPending, billsMatch, billsPay, openInvoices] =
    await Promise.all([
      db.order.count({
        where: {
          status: {
            in: [
              OrderStatus.PENDING_ADMIN_APPROVAL,
              OrderStatus.PENDING_CHEF_APPROVAL,
              OrderStatus.CHANGES_PROPOSED_BY_CHEF,
            ],
          },
        },
      }),
      db.chefRequisition.count({
        where: {
          status: { in: [ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED] },
          order: { status: { notIn: INACTIVE_ORDER_STATUSES } },
        },
      }),
      db.ingredient.findMany({ where: { active: true }, select: { onHandQty: true, reorderLevel: true } }),
      db.vendorPO.count({ where: { status: VendorPOStatus.PENDING_APPROVAL } }),
      db.vendorBill.count({
        where: { status: { in: [VendorBillStatus.DRAFT, VendorBillStatus.PENDING_MATCH, VendorBillStatus.DISCREPANCY] } },
      }),
      db.vendorBill.count({
        where: { status: { in: [VendorBillStatus.MATCHED, VendorBillStatus.APPROVED, VendorBillStatus.OVERDUE] } },
      }),
      db.customerInvoice.findMany({
        where: { status: { in: [CustomerInvoiceStatus.ISSUED, CustomerInvoiceStatus.PARTIAL] } },
        select: { dueAt: true },
      }),
    ]);

  const lowStock = ingredients.filter((i) => toDecimal(i.onHandQty).lte(toDecimal(i.reorderLevel))).length;
  const buy = poPending + billsMatch + billsPay;
  const overdueInvoices = openInvoices.filter((i) => i.dueAt && i.dueAt < now).length;

  const badges: NavBadges = {};
  if (pendingOrders > 0) badges.sell = { count: pendingOrders, tone: "red" };
  if (openReqs > 0) badges.make = { count: openReqs, tone: "amber" };
  if (lowStock > 0) badges.stores = { count: lowStock, tone: "red" };
  if (buy > 0) badges.buy = { count: buy, tone: "red" };
  if (overdueInvoices > 0) badges.money = { count: overdueInvoices, tone: "red" };
  else if (openInvoices.length > 0) badges.money = { count: openInvoices.length, tone: "amber" };
  return badges;
}
