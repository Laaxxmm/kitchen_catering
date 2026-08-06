"use server";

import { Role, VendorBillStatus } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { toDecimal } from "@/lib/money";
import { isPayable } from "@/lib/vendor-bill-gates";

const REVIEW_ROLES = [Role.ADMIN, Role.MANAGER];

/**
 * The "needs you now" worklist — the same buckets that drive the dashboard
 * attention banner, but with the actual rows so the user can clear each item
 * without bouncing between pages. Low-stock items reorder straight into a
 * purchase order (no requisition step).
 */
export async function getReviewWorklist() {
  await requireRole(REVIEW_ROLES);

  const [matchBills, payBills, ingredients] = await Promise.all([
    // 1. Supplier bills needing a 3-way match (have a PO to match against).
    db.vendorBill.findMany({
      where: {
        status: { in: [VendorBillStatus.DRAFT, VendorBillStatus.PENDING_MATCH, VendorBillStatus.DISCREPANCY] },
        poId: { not: null },
      },
      orderBy: { issueDate: "asc" },
      select: { id: true, billNo: true, grandTotal: true, vendor: { select: { name: true } } },
    }),
    // 2. Matched/approved bills still owing money.
    db.vendorBill.findMany({
      where: {
        status: { in: [VendorBillStatus.MATCHED, VendorBillStatus.APPROVED, VendorBillStatus.OVERDUE] },
      },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        billNo: true,
        status: true,
        grandTotal: true,
        amountPaid: true,
        dueDate: true,
        vendor: { select: { name: true } },
      },
    }),
    // 3. Ingredients at/below reorder level.
    db.ingredient.findMany({
      where: { active: true },
      select: { id: true, name: true, unit: true, onHandQty: true, reorderLevel: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const now = new Date();

  const billsToMatch = matchBills.map((b) => ({
    id: b.id,
    billNo: b.billNo,
    vendor: b.vendor.name,
    amount: toDecimal(b.grandTotal).toString(),
  }));

  const billsToPay = payBills
    .map((b) => ({
      id: b.id,
      billNo: b.billNo,
      vendor: b.vendor.name,
      amount: toDecimal(b.grandTotal).minus(toDecimal(b.amountPaid)).toString(),
      due: b.dueDate ? b.dueDate.toISOString() : null,
      overdue: !!(b.dueDate && b.dueDate < now),
      // A matched bill nobody has approved is still on the list — it just
      // needs approving before any money moves.
      payable: isPayable(b.status),
    }))
    .filter((b) => toDecimal(b.amount).gt(0));

  const lowStock = ingredients
    .filter((i) => toDecimal(i.onHandQty).lte(toDecimal(i.reorderLevel)))
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      onHand: toDecimal(i.onHandQty).toString(),
      reorderLevel: toDecimal(i.reorderLevel).toString(),
      out: toDecimal(i.onHandQty).lte(0),
    }));

  const total = billsToMatch.length + billsToPay.length + lowStock.length;
  return { billsToMatch, billsToPay, lowStock, total };
}
