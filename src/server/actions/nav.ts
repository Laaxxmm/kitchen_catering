"use server";

import { unstable_cache } from "next/cache";
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
import { INACTIVE_ORDER_STATUSES } from "@/lib/order-status";
import { EXCLUDE_PROFORMA } from "@/lib/invoice-kinds";
import type { NavBadges } from "@/lib/nav-config";

/**
 * Per-group "needs you" badges for the sidebar. Only computed for
 * admin/manager (the roles that see every group); other roles have small,
 * focused navs that don't need badges. All counts come from existing data —
 * nothing is hardcoded. Zero counts are omitted so no badge renders.
 *
 * The layout renders this on EVERY navigation, so the (org-wide) counts are
 * cached for 30s — the badges are just "needs you" hints, so slight staleness
 * is fine, and it keeps every page load from re-running ~8 count queries.
 */
export async function getNavBadges(): Promise<NavBadges> {
  const session = await requireSession();
  if (!hasRole(session, [Role.ADMIN, Role.MANAGER])) return {};
  return computeNavBadges();
}

const computeNavBadges = unstable_cache(
  async (): Promise<NavBadges> => {
  const now = new Date();

  const [pendingOrders, openReqs, lowStockRows, poPending, billsMatch, billsPay, openInvoices, overdueInvoices] =
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
      // Column-to-column comparison isn't expressible in Prisma's where —
      // count in SQL rather than fetching every ingredient to filter in JS.
      db.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM "Ingredient"
        WHERE "active" = true AND "onHandQty" <= "reorderLevel"`,
      db.vendorPO.count({ where: { status: VendorPOStatus.PENDING_APPROVAL } }),
      db.vendorBill.count({
        where: { status: { in: [VendorBillStatus.DRAFT, VendorBillStatus.PENDING_MATCH, VendorBillStatus.DISCREPANCY] } },
      }),
      db.vendorBill.count({
        where: { status: { in: [VendorBillStatus.MATCHED, VendorBillStatus.APPROVED, VendorBillStatus.OVERDUE] } },
      }),
      db.customerInvoice.count({
        where: { status: { in: [CustomerInvoiceStatus.ISSUED, CustomerInvoiceStatus.PARTIAL] }, ...EXCLUDE_PROFORMA },
      }),
      db.customerInvoice.count({
        where: {
          status: { in: [CustomerInvoiceStatus.ISSUED, CustomerInvoiceStatus.PARTIAL] },
          dueAt: { lt: now },
          ...EXCLUDE_PROFORMA,
        },
      }),
    ]);

  const lowStock = lowStockRows[0]?.count ?? 0;
  const buy = poPending + billsMatch + billsPay;

  const badges: NavBadges = {};
  if (pendingOrders > 0) badges.sell = { count: pendingOrders, tone: "red" };
  if (openReqs > 0) badges.make = { count: openReqs, tone: "amber" };
  if (lowStock > 0) badges.stores = { count: lowStock, tone: "red" };
  if (buy > 0) badges.buy = { count: buy, tone: "red" };
  if (overdueInvoices > 0) badges.money = { count: overdueInvoices, tone: "red" };
  else if (openInvoices > 0) badges.money = { count: openInvoices, tone: "amber" };
  return badges;
  },
  ["nav-badges-v1"],
  { revalidate: 30 },
);
