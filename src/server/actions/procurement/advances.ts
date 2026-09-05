"use server";

/**
 * Money handed to a vendor ahead of a bill, and applying it when the bill arrives
 * so the same rupees are never paid twice.
 */

import { revalidatePath } from "next/cache";
import { Role, VendorBillStatus } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { ActionError, actionFailure, type ActionResult, type ActionResultWith } from "@/server/action-result";
import { payRefusal } from "@/lib/vendor-bill-gates";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";

// =====================================================================
// VENDOR ADVANCES (paid before the bill exists — client item #12)
// =====================================================================

const ADVANCE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];

/** Record money already paid to a supplier ahead of their bill. */
export async function recordVendorAdvance(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(ADVANCE_ROLES);
    const { VendorAdvanceInput } = await import("@/lib/validators");
    const input = VendorAdvanceInput.parse(raw);
    const amount = toDecimal(input.amount || "0");
    if (amount.lte(0)) throw new ActionError("Enter an advance amount greater than zero.");
    const paidAtDate = new Date(input.paidAt);
    if (Number.isNaN(paidAtDate.getTime())) throw new ActionError("Enter a valid payment date.");

    const row = await db.$transaction(async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId }, select: { name: true } });
      if (!vendor) throw new ActionError("Vendor not found — refresh and pick again.");
      const created = await tx.vendorAdvance.create({
        data: {
          vendorId: input.vendorId,
          poId: input.poId || null,
          amount: amount.toFixed(2),
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          paidAt: paidAtDate,
          recordedById: session.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_ADVANCE_RECORDED",
          entity: "VendorAdvance",
          entityId: created.id,
          payloadHash: sha256Json({ vendorId: input.vendorId, amount: amount.toString(), poId: input.poId ?? null }),
        },
      });
      return created;
    });

    revalidatePath("/procurement/vendor-bills");
    return { ok: true, id: row.id };
  } catch (err) {
    return actionFailure(err);
  }
}

/** Unapplied advances for one vendor — offered on their bills for applying. */
export async function listOpenVendorAdvances(vendorId: string) {
  await requireRole(ADVANCE_ROLES);
  return db.vendorAdvance.findMany({
    where: { vendorId, appliedToBillId: null },
    include: { po: { select: { poNo: true } }, recordedBy: { select: { name: true } } },
    orderBy: { paidAt: "asc" },
  });
}

/**
 * Apply an unapplied advance to a bill of the same vendor. Posts a real
 * VendorBillPayment for the amount (so the payables ledger reconciles) and
 * marks the advance consumed. Refuses when the advance exceeds the bill's
 * open balance — that split needs a human decision, not a silent remainder.
 */
export async function applyVendorAdvanceToBill(
  advanceId: string,
  billId: string,
): Promise<ActionResult> {
  try {
    const session = await requireRole(ADVANCE_ROLES);
    await db.$transaction(async (tx) => {
      // Lock the bill row — amountPaid is read-modify-write below.
      await tx.$executeRaw`SELECT 1 FROM "VendorBill" WHERE "id" = ${billId} FOR UPDATE`;
      const [advance, bill] = await Promise.all([
        tx.vendorAdvance.findUnique({
          where: { id: advanceId },
          select: { vendorId: true, amount: true, appliedToBillId: true, reference: true, method: true },
        }),
        tx.vendorBill.findUnique({
          where: { id: billId },
          select: { vendorId: true, status: true, grandTotal: true, amountPaid: true, billNo: true },
        }),
      ]);
      if (!advance) throw new ActionError("Advance not found — refresh the page.");
      if (advance.appliedToBillId) throw new ActionError("This advance is already applied to a bill.");
      if (!bill) throw new ActionError("Bill not found");
      if (advance.vendorId !== bill.vendorId) {
        throw new ActionError("This advance belongs to a different supplier.");
      }
      // Applying an advance posts a payment row and can settle the bill, so
      // it goes through the same approval gate as any other payment.
      const refusal = payRefusal(bill.billNo, bill.status);
      if (refusal) throw new ActionError(refusal);
      const balance = toDecimal(bill.grandTotal).minus(toDecimal(bill.amountPaid));
      const amount = toDecimal(advance.amount);
      if (amount.gt(balance)) {
        throw new ActionError(
          `The advance (${amount.toFixed(2)}) is larger than this bill's balance (${balance.toFixed(2)}) — settle the bill with Mark paid and keep the advance for the next one.`,
        );
      }

      // Consume the advance first with a guarded update — a double-click
      // loses the race and applies nothing twice.
      const consumed = await tx.vendorAdvance.updateMany({
        where: { id: advanceId, appliedToBillId: null },
        data: { appliedToBillId: billId, appliedAt: new Date() },
      });
      if (consumed.count === 0) throw new ActionError("This advance was just applied — refresh.");

      const newPaid = toDecimal(bill.amountPaid).plus(amount);
      const fullyPaid = newPaid.gte(toDecimal(bill.grandTotal));
      await tx.vendorBill.update({
        where: { id: billId },
        data: {
          amountPaid: newPaid.toFixed(2),
          ...(fullyPaid ? { status: VendorBillStatus.PAID, paidAt: new Date() } : {}),
        },
      });
      await tx.vendorBillPayment.create({
        data: {
          vendorBillId: billId,
          amount: amount.toFixed(2),
          paidAt: new Date(),
          method: advance.method,
          reference: advance.reference ?? null,
          notes: "Advance applied",
          recordedById: session.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_ADVANCE_APPLIED",
          entity: "VendorAdvance",
          entityId: advanceId,
          payloadHash: sha256Json({ billId, billNo: bill.billNo, amount: amount.toString() }),
        },
      });
    });

    revalidatePath(`/procurement/vendor-bills/${billId}`);
    revalidatePath("/procurement/vendor-bills");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}
