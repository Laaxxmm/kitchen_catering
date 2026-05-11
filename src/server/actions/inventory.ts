"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  IngredientInput,
  IngredientReceiptInput,
  IngredientIssueInput,
} from "@/lib/validators";
import { newMovingAverage } from "@/lib/inventory-cost";
import { toDecimal } from "@/lib/money";
import { sha256Json } from "@/lib/audit";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.SALES, Role.ACCOUNTS,
];

export async function createIngredient(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = IngredientInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    const created = await tx.ingredient.create({
      data: {
        sku: input.sku,
        name: input.name,
        category: input.category ?? null,
        unit: input.unit,
        openingQty: input.openingQty ?? "0",
        openingAvgCost: input.openingAvgCost ?? "0",
        // Initial onHand equals opening so a Phase-0 seeded ingredient with
        // openingQty=10 shows up as 10 on hand immediately.
        onHandQty: input.openingQty ?? "0",
        avgUnitCost: input.openingAvgCost ?? "0",
        reorderLevel: input.reorderLevel ?? "0",
        preferredVendorId: input.preferredVendorId ?? null,
        hsnSac: input.hsnSac ?? null,
        gstRatePct: input.gstRatePct ?? "0",
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_CREATED",
        entity: "Ingredient",
        entityId: created.id,
        payloadHash: sha256Json({ sku: input.sku, name: input.name }),
      },
    });
    return created;
  });

  revalidatePath("/inventory/ingredients");
  return { id: row.id };
}

export async function updateIngredient(id: string, raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = IngredientInput.parse(raw);
  await db.$transaction(async (tx) => {
    await tx.ingredient.update({
      where: { id },
      data: {
        sku: input.sku,
        name: input.name,
        category: input.category ?? null,
        unit: input.unit,
        reorderLevel: input.reorderLevel ?? "0",
        preferredVendorId: input.preferredVendorId ?? null,
        hsnSac: input.hsnSac ?? null,
        gstRatePct: input.gstRatePct ?? "0",
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_UPDATED",
        entity: "Ingredient",
        entityId: id,
      },
    });
  });
  revalidatePath("/inventory/ingredients");
  revalidatePath(`/inventory/ingredients/${id}`);
}

export async function deactivateIngredient(id: string) {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    await tx.ingredient.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_DEACTIVATED",
        entity: "Ingredient",
        entityId: id,
      },
    });
  });
  revalidatePath("/inventory/ingredients");
}

/**
 * Record a receipt and apply moving-average to the ingredient.
 *   newQty  = onHand + receiptQty
 *   newAvg  = (onHand * avg + receiptQty * receiptUnitCost) / newQty
 *
 * Both updates happen in the same transaction, with an AuditLog row.
 */
export async function recordIngredientReceipt(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = IngredientReceiptInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const ingredient = await tx.ingredient.findUnique({ where: { id: input.ingredientId } });
    if (!ingredient) throw new Error("Ingredient not found");

    const { qty, avgUnitCost } = newMovingAverage({
      onHandQty: ingredient.onHandQty,
      avgUnitCost: ingredient.avgUnitCost,
      receiptQty: input.qty,
      receiptUnitCost: input.unitCost,
    });

    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();

    const receipt = await tx.ingredientReceipt.create({
      data: {
        ingredientId: input.ingredientId,
        qty: input.qty,
        unitCost: input.unitCost,
        supplier: input.supplier ?? null,
        receivedAt,
        note: input.note ?? null,
      },
    });

    await tx.ingredient.update({
      where: { id: input.ingredientId },
      data: {
        onHandQty: qty.toDecimalPlaces(3).toString(),
        avgUnitCost: avgUnitCost.toDecimalPlaces(4).toString(),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_RECEIPT_RECORDED",
        entity: "IngredientReceipt",
        entityId: receipt.id,
        payloadHash: sha256Json({
          ingredientId: input.ingredientId,
          qty: input.qty,
          unitCost: input.unitCost,
        }),
      },
    });
    return receipt;
  });

  revalidatePath("/inventory/ingredients");
  revalidatePath("/inventory/receipts");
  return { id: result.id };
}

/**
 * Direct issue path (for emergencies / out-of-band consumption). Most issues
 * arrive via the chef-requisition flow (see chef-requisitions.ts:issueChefRequisitionLine)
 * which calls the same primitive. Decrements onHandQty; never touches avgUnitCost
 * (moving-average is for receipts only). Refuses to issue if it would make
 * stock negative.
 */
export async function recordDirectIngredientIssue(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = IngredientIssueInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const ingredient = await tx.ingredient.findUnique({ where: { id: input.ingredientId } });
    if (!ingredient) throw new Error("Ingredient not found");

    const issueQty = toDecimal(input.qty);
    const onHand = toDecimal(ingredient.onHandQty);
    if (issueQty.lte(0)) throw new Error("Issue quantity must be positive");
    if (issueQty.gt(onHand)) {
      throw new Error(
        `Insufficient stock. On hand: ${onHand.toString()}, requested: ${issueQty.toString()}`,
      );
    }

    const issue = await tx.ingredientIssue.create({
      data: {
        ingredientId: input.ingredientId,
        orderId: input.orderId,
        qty: input.qty,
        unitCostAtIssue: ingredient.avgUnitCost.toString(),
        issuedById: session.user.id,
        issuedAt: new Date(),
        note: input.note ?? null,
      },
    });

    await tx.ingredient.update({
      where: { id: input.ingredientId },
      data: { onHandQty: onHand.minus(issueQty).toDecimalPlaces(3).toString() },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_ISSUE_RECORDED",
        entity: "IngredientIssue",
        entityId: issue.id,
        payloadHash: sha256Json({
          ingredientId: input.ingredientId,
          qty: input.qty,
          orderId: input.orderId,
        }),
      },
    });
    return issue;
  });

  revalidatePath("/inventory/ingredients");
  revalidatePath("/inventory/issues");
  return { id: result.id };
}

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listIngredients(opts: { query?: string; active?: boolean; lowStock?: boolean } = {}) {
  await requireRole(READ_ROLES);
  const rows = await db.ingredient.findMany({
    where: {
      ...(opts.active !== undefined ? { active: opts.active } : {}),
      ...(opts.query
        ? {
            OR: [
              { name: { contains: opts.query, mode: "insensitive" } },
              { sku: { contains: opts.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 300,
  });
  return opts.lowStock
    ? rows.filter((r) => toDecimal(r.onHandQty).lte(toDecimal(r.reorderLevel)))
    : rows;
}

export async function getIngredient(id: string) {
  await requireRole(READ_ROLES);
  return db.ingredient.findUnique({ where: { id } });
}

export async function listRecentReceipts(opts: { limit?: number } = {}) {
  await requireRole(READ_ROLES);
  return db.ingredientReceipt.findMany({
    orderBy: { receivedAt: "desc" },
    take: opts.limit ?? 50,
    include: { ingredient: { select: { name: true, sku: true, unit: true } } },
  });
}

export async function listRecentIssues(opts: { limit?: number } = {}) {
  await requireRole(READ_ROLES);
  return db.ingredientIssue.findMany({
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
    include: {
      ingredient: { select: { name: true, sku: true, unit: true } },
      order: { select: { code: true } },
    },
  });
}
