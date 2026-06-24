"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import {
  PurchaseRequisitionStatus,
  Role,
  VendorBillStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { nextPRNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";

const REVIEW_ROLES = [Role.ADMIN, Role.MANAGER];

/**
 * The "needs you now" worklist — the same four buckets that drive the
 * dashboard attention banner, but with the actual rows so the user can
 * clear each item without bouncing between pages.
 */
export async function getReviewWorklist() {
  await requireRole(REVIEW_ROLES);

  const [approvedPRs, matchBills, payBills, ingredients] = await Promise.all([
    // 1. Approved requisitions still awaiting a PO.
    db.purchaseRequisition.findMany({
      where: { status: PurchaseRequisitionStatus.APPROVED },
      orderBy: { approvedAt: "asc" },
      select: {
        id: true,
        prNo: true,
        lines: { select: { requestedQty: true, unitCostSnapshot: true } },
      },
    }),
    // 2. Supplier bills needing a 3-way match (have a PO to match against).
    db.vendorBill.findMany({
      where: {
        status: { in: [VendorBillStatus.DRAFT, VendorBillStatus.PENDING_MATCH, VendorBillStatus.DISCREPANCY] },
        poId: { not: null },
      },
      orderBy: { issueDate: "asc" },
      select: { id: true, billNo: true, grandTotal: true, vendor: { select: { name: true } } },
    }),
    // 3. Matched/approved bills still owing money.
    db.vendorBill.findMany({
      where: {
        status: { in: [VendorBillStatus.MATCHED, VendorBillStatus.APPROVED, VendorBillStatus.OVERDUE] },
      },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        billNo: true,
        grandTotal: true,
        amountPaid: true,
        dueDate: true,
        vendor: { select: { name: true } },
      },
    }),
    // 4. Ingredients at/below reorder level.
    db.ingredient.findMany({
      where: { active: true },
      select: { id: true, name: true, unit: true, onHandQty: true, reorderLevel: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const now = new Date();

  const issuePOs = approvedPRs.map((pr) => ({
    id: pr.id,
    prNo: pr.prNo,
    lineCount: pr.lines.length,
    estValue: pr.lines
      .reduce((s, l) => s.plus(toDecimal(l.requestedQty).times(toDecimal(l.unitCostSnapshot))), new Decimal(0))
      .toDecimalPlaces(2)
      .toString(),
  }));

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

  const total = issuePOs.length + billsToMatch.length + billsToPay.length + lowStock.length;
  return { issuePOs, billsToMatch, billsToPay, lowStock, total };
}

/**
 * Create ONE draft purchase requisition pre-filled with every ingredient at
 * or below its reorder level. Shared by the Review page's reorder button and
 * the Stock page's "Add all to stock request". Returns the new PR id so the
 * caller can navigate the user straight to it. Suggested qty tops each item
 * back up to its reorder level (min 1).
 */
export async function createLowStockRequisition() {
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER]);

  const ingredients = await db.ingredient.findMany({
    where: { active: true },
    select: { id: true, onHandQty: true, reorderLevel: true, avgUnitCost: true },
  });
  const low = ingredients.filter((i) => toDecimal(i.onHandQty).lte(toDecimal(i.reorderLevel)));
  if (low.length === 0) throw new Error("No ingredients are below their reorder level.");

  const result = await db.$transaction(async (tx) => {
    const prNo = await nextPRNumber(tx);
    const pr = await tx.purchaseRequisition.create({
      data: {
        prNo,
        requestedById: session.user.id,
        status: PurchaseRequisitionStatus.DRAFT,
        notes: "Auto-filled from low-stock review.",
        lines: {
          create: low.map((i) => {
            const topUp = toDecimal(i.reorderLevel).minus(toDecimal(i.onHandQty));
            const qty = topUp.gt(0) ? topUp : new Decimal(1);
            return {
              ingredientId: i.id,
              requestedQty: qty.toDecimalPlaces(3).toString(),
              unitCostSnapshot: toDecimal(i.avgUnitCost).toString(),
            };
          }),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PR_CREATED",
        entity: "PurchaseRequisition",
        entityId: pr.id,
        payloadHash: sha256Json({ prNo, source: "low-stock", lines: low.length }),
      },
    });
    return pr;
  });

  revalidatePath("/procurement/purchase-requisitions");
  return { id: result.id, prNo: result.prNo, lineCount: low.length };
}
