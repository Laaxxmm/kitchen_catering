"use server";

import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { ActionError, actionFailure, type ActionResultWith } from "@/server/action-result";
import { newMovingAverage } from "@/lib/inventory-cost";
import { toDecimal } from "@/lib/money";
import { sha256Json } from "@/lib/audit";

/**
 * Recover stock for goods that were received (GRN accepted) but never
 * credited to inventory. createGRN skips auto-posting when a PO line's unit
 * doesn't match the ingredient's catalogue unit (e.g. bought in "pct",
 * tracked in "kg") or when the line is free text — it warns instead, so the
 * goods sit in stock at zero. This finds every such line and, where it can
 * do so safely, posts the missing receipt.
 *
 * The unique IngredientReceipt.grnLineId is the idempotency key: a line that
 * already posted has a receipt, so it can never be counted or posted twice.
 * Everything it writes goes through the same moving-average maths + an audit
 * row, so it's traceable and re-runnable.
 */

export interface UnpostedLine {
  grnLineId: string;
  grnNo: string;
  poNo: string;
  ingredientId: string | null;
  itemName: string;
  sku: string;
  acceptedQty: string;
  poUnit: string;
  catalogueUnit: string | null;
  unitPrice: string;
  reason: "unit-mismatch-fresh" | "unit-match" | "unit-mismatch-has-stock" | "free-text";
  postable: boolean;
}

const MAX = 5000;

async function classify(): Promise<UnpostedLine[]> {
  const lines = await db.gRNLine.findMany({
    // Kitchen lines only: a banquet line (banquetItemId set) posts to
    // BanquetReceipt, never IngredientReceipt, so it would always look
    // "unposted" here — exclude it. That leaves kitchen linked lines that
    // didn't post plus kitchen free-text lines (both ids null).
    where: { acceptedQty: { gt: 0 }, ingredientReceipt: { is: null }, poLine: { banquetItemId: null } },
    take: MAX,
    orderBy: { grn: { receivedAt: "asc" } },
    select: {
      id: true,
      acceptedQty: true,
      grn: { select: { grnNo: true, po: { select: { poNo: true } } } },
      poLine: {
        select: {
          unit: true, unitPrice: true, description: true, sku: true, ingredientId: true,
          ingredient: {
            select: {
              name: true, unit: true, onHandQty: true,
              _count: { select: { receipts: true, issues: true } },
            },
          },
        },
      },
    },
  });

  return lines.map((l) => {
    const p = l.poLine;
    const base = {
      grnLineId: l.id,
      grnNo: l.grn.grnNo,
      poNo: l.grn.po.poNo,
      sku: p.sku ?? "",
      acceptedQty: l.acceptedQty.toString(),
      poUnit: p.unit,
      unitPrice: p.unitPrice.toString(),
    };
    // Free text — nothing to post to.
    if (!p.ingredientId || !p.ingredient) {
      return { ...base, ingredientId: null, itemName: p.description, catalogueUnit: null, reason: "free-text" as const, postable: false };
    }
    const ing = p.ingredient;
    const unitSame = p.unit.trim().toLowerCase() === ing.unit.trim().toLowerCase();
    const fresh = toDecimal(ing.onHandQty).eq(0) && ing._count.receipts === 0 && ing._count.issues === 0;
    const reason: UnpostedLine["reason"] = unitSame
      ? "unit-match"
      : fresh
        ? "unit-mismatch-fresh"
        : "unit-mismatch-has-stock";
    return {
      ...base,
      ingredientId: p.ingredientId,
      itemName: ing.name,
      catalogueUnit: ing.unit,
      reason,
      // Post when units already agree, or when the item is untouched so we can
      // safely re-base its unit to what was actually bought. An item that
      // already carries stock in a different unit needs a human (real
      // conversion), so it's flagged, not guessed.
      postable: unitSame || reason === "unit-mismatch-fresh",
    };
  });
}

/** Read-only preview — what would be posted and what needs a human. */
export async function previewGrnStockReconcile(): Promise<
  ActionResultWith<{ lines: UnpostedLine[]; postable: number; manual: number }>
> {
  try {
    await requireRole([Role.ADMIN, Role.MANAGER]);
    const lines = await classify();
    return { ok: true, lines, postable: lines.filter((l) => l.postable).length, manual: lines.filter((l) => !l.postable).length };
  } catch (err) {
    return actionFailure(err);
  }
}

/** Post every safely-postable unposted GRN line. Admin only. Idempotent. */
export async function applyGrnStockReconcile(): Promise<ActionResultWith<{ posted: number; skipped: number }>> {
  try {
    const session = await requireRole([Role.ADMIN]);
    const candidates = (await classify()).filter((l) => l.postable && l.ingredientId);

    let posted = 0;
    let skipped = 0;
    for (const c of candidates) {
      const done = await db.$transaction(async (tx) => {
        // Idempotency + race guard: re-check under a row lock that this GRN
        // line still has no receipt before posting.
        await tx.$executeRaw`SELECT 1 FROM "Ingredient" WHERE "id" = ${c.ingredientId!} FOR UPDATE`;
        const existing = await tx.ingredientReceipt.findUnique({ where: { grnLineId: c.grnLineId }, select: { id: true } });
        if (existing) return false;

        const ing = await tx.ingredient.findUniqueOrThrow({
          where: { id: c.ingredientId! },
          select: { id: true, unit: true, onHandQty: true, avgUnitCost: true, name: true },
        });

        // Re-base the catalogue unit to the purchase unit only while the item
        // is still untouched (guarded again under the lock).
        const unitSame = c.poUnit.trim().toLowerCase() === ing.unit.trim().toLowerCase();
        if (!unitSame) {
          const receipts = await tx.ingredientReceipt.count({ where: { ingredientId: ing.id } });
          const issues = await tx.ingredientIssue.count({ where: { ingredientId: ing.id } });
          if (!(toDecimal(ing.onHandQty).eq(0) && receipts === 0 && issues === 0)) return false; // no longer fresh
          await tx.ingredient.update({ where: { id: ing.id }, data: { unit: c.poUnit } });
        }

        const accepted = toDecimal(c.acceptedQty);
        const { qty, avgUnitCost } = newMovingAverage({
          onHandQty: ing.onHandQty,
          avgUnitCost: ing.avgUnitCost,
          receiptQty: accepted,
          receiptUnitCost: toDecimal(c.unitPrice),
        });
        await tx.ingredient.update({
          where: { id: ing.id },
          data: { onHandQty: qty.toDecimalPlaces(3).toString(), avgUnitCost: avgUnitCost.toDecimalPlaces(4).toString() },
        });
        await tx.ingredientReceipt.create({
          data: {
            ingredientId: ing.id,
            qty: accepted.toString(),
            unitCost: c.unitPrice,
            receivedAt: new Date(),
            supplier: null,
            note: `Reconciled from GRN ${c.grnNo} (received but not posted)`,
            grnLineId: c.grnLineId,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: "GRN_STOCK_RECONCILED",
            entity: "GRNLine",
            entityId: c.grnLineId,
            payloadHash: sha256Json({ ingredientId: ing.id, qty: c.acceptedQty, poUnit: c.poUnit, grnNo: c.grnNo }),
          },
        });
        return true;
      });
      if (done) posted++;
      else skipped++;
    }

    if (posted === 0 && skipped === 0) throw new ActionError("Nothing to reconcile — no unposted received goods found.");
    return { ok: true, posted, skipped };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Manually post one flagged GRN line, with the admin deciding the quantity and
 * unit to book. For a unit mismatch where the item already holds stock, only a
 * human knows the conversion (how many catalogue-units a purchase pack is), so
 * they enter it here. The GRN line's total value (accepted × PO price) is
 * preserved: the per-unit cost is derived from the quantity booked, so
 * whatever unit is chosen the stock is valued at the same rupees. When the
 * chosen unit differs from the catalogue, the item is re-based to it (the
 * admin's explicit call). Admin only, idempotent (unique grnLineId), audited.
 */
export async function postReconcileLineManual(input: {
  grnLineId: string;
  quantity: string;
  unit: string;
}): Promise<ActionResultWith<{ posted: true }>> {
  try {
    const session = await requireRole([Role.ADMIN]);
    const qty = toDecimal(input.quantity || "0");
    const unit = input.unit.trim();
    if (qty.lte(0)) throw new ActionError("Enter a quantity greater than zero.");
    if (!unit) throw new ActionError("Enter the unit to book the stock in.");

    await db.$transaction(async (tx) => {
      const line = await tx.gRNLine.findUnique({
        where: { id: input.grnLineId },
        select: {
          acceptedQty: true,
          grn: { select: { grnNo: true } },
          poLine: { select: { ingredientId: true, unitPrice: true } },
          ingredientReceipt: { select: { id: true } },
        },
      });
      if (!line) throw new ActionError("GRN line not found — refresh the page.");
      if (line.ingredientReceipt) throw new ActionError("This line is already in stock.");
      const ingredientId = line.poLine.ingredientId;
      if (!ingredientId) throw new ActionError("This line isn't linked to a kitchen item — add it to stock and record a receipt instead.");

      await tx.$executeRaw`SELECT 1 FROM "Ingredient" WHERE "id" = ${ingredientId} FOR UPDATE`;
      // Re-check no receipt slipped in under the lock (idempotency).
      const dup = await tx.ingredientReceipt.findUnique({ where: { grnLineId: input.grnLineId }, select: { id: true } });
      if (dup) throw new ActionError("This line is already in stock.");

      const ing = await tx.ingredient.findUniqueOrThrow({
        where: { id: ingredientId },
        select: { id: true, unit: true, onHandQty: true, avgUnitCost: true },
      });

      // Preserve the line's total value: value = accepted × PO unit price,
      // spread over the quantity the admin is booking.
      const totalValue = toDecimal(line.acceptedQty).times(toDecimal(line.poLine.unitPrice));
      const receiptUnitCost = totalValue.div(qty);

      if (unit.toLowerCase() !== ing.unit.trim().toLowerCase()) {
        await tx.ingredient.update({ where: { id: ing.id }, data: { unit } });
      }
      const { qty: newQty, avgUnitCost: newAvg } = newMovingAverage({
        onHandQty: ing.onHandQty,
        avgUnitCost: ing.avgUnitCost,
        receiptQty: qty,
        receiptUnitCost,
      });
      await tx.ingredient.update({
        where: { id: ing.id },
        data: { onHandQty: newQty.toDecimalPlaces(3).toString(), avgUnitCost: newAvg.toDecimalPlaces(4).toString() },
      });
      await tx.ingredientReceipt.create({
        data: {
          ingredientId: ing.id,
          qty: qty.toString(),
          unitCost: receiptUnitCost.toDecimalPlaces(4).toString(),
          receivedAt: new Date(),
          supplier: null,
          note: `Reconciled (manual) from GRN ${line.grn.grnNo}`,
          grnLineId: input.grnLineId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "GRN_STOCK_RECONCILED_MANUAL",
          entity: "GRNLine",
          entityId: input.grnLineId,
          payloadHash: sha256Json({ ingredientId: ing.id, quantity: input.quantity, unit, grnNo: line.grn.grnNo }),
        },
      });
    });

    return { ok: true, posted: true };
  } catch (err) {
    return actionFailure(err);
  }
}
