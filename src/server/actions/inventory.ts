"use server";

import { revalidatePath } from "next/cache";
import { Role, type Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  IngredientAdjustmentInput,
  IngredientInput,
  IngredientReceiptInput,
  IngredientIssueInput,
} from "@/lib/validators";
import { newMovingAverage } from "@/lib/inventory-cost";
import { toDecimal } from "@/lib/money";
import { sha256Json } from "@/lib/audit";
import { getSettingOr } from "@/lib/settings";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

/**
 * Row-lock an ingredient for the rest of the transaction. Every stock
 * movement (receipt / issue / adjustment) reads onHandQty/avgUnitCost,
 * computes, then writes back — without the lock two concurrent movements
 * read the same snapshot and one update is silently lost (stock can even
 * go negative past the "insufficient stock" check). FOR UPDATE serialises
 * them: the second caller waits, then reads the committed value.
 */
async function lockIngredientRow(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "Ingredient" WHERE "id" = ${id} FOR UPDATE`;
}

// Stock movements (receipts / issues) — the store's job (+ management).
const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];
// Managing the ingredient CATALOGUE (add / edit / deactivate / reorder level)
// is broader: the chef (kitchen head) also curates the kitchen's item list,
// so they can add ingredients — but not record receipts or issue stock.
const CATALOG_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD];
// Manual stock corrections (write-offs, opening fixes, post-count tweaks)
// are admin/manager only. Storekeeper records new stock through receipts
// — that path has a unit cost + supplier, this one is a free-form quantity
// edit and is sensitive.
const ADJUST_ROLES = [Role.ADMIN, Role.MANAGER];
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.SALES, Role.ACCOUNTS,
];

/**
 * Set an ingredient's reorder level inline from the stock list. The field
 * already exists on the schema (it just defaulted to 0 everywhere); this
 * gives the store a quick way to populate it so the Out/Low/In-stock status
 * actually means something. Accepts any non-negative quantity.
 */
export async function setReorderLevel(id: string, value: string): Promise<ActionResult> {
  try {
    return await setReorderLevelInner(id, value);
  } catch (err) {
    return actionFailure(err);
  }
}

async function setReorderLevelInner(id: string, value: string): Promise<{ ok: true }> {
  const session = await requireRole(CATALOG_ROLES);
  const qty = toDecimal(value || "0");
  if (qty.lt(0)) throw new ActionError("Reorder level can't be negative");
  await db.$transaction(async (tx) => {
    await tx.ingredient.update({
      where: { id },
      data: { reorderLevel: qty.toDecimalPlaces(3).toString() },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_REORDER_LEVEL_SET",
        entity: "Ingredient",
        entityId: id,
        payloadHash: sha256Json({ reorderLevel: qty.toString() }),
      },
    });
  });
  revalidatePath("/inventory/ingredients");
  return { ok: true };
}

export async function createIngredient(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await createIngredientInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createIngredientInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(CATALOG_ROLES);
  const input = IngredientInput.parse(raw);

  // Friendly duplicate check up front (the DB unique on sku still backstops
  // this — actionFailure maps its P2002 to a readable message).
  const dupe = await db.ingredient.findFirst({
    where: { sku: { equals: input.sku, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (dupe) {
    throw new ActionError(`SKU "${input.sku}" is already used by "${dupe.name}".`);
  }

  const row = await db.$transaction(async (tx) => {
    const created = await tx.ingredient.create({
      data: {
        sku: input.sku,
        name: input.name,
        category: input.category ?? null,
        ...(input.subStore ? { subStore: input.subStore } : {}),
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
  return { ok: true, id: row.id };
}

export async function updateIngredient(id: string, raw: unknown): Promise<ActionResult> {
  try {
    return await updateIngredientInner(id, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function updateIngredientInner(id: string, raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(CATALOG_ROLES);
  const input = IngredientInput.parse(raw);
  await db.$transaction(async (tx) => {
    await tx.ingredient.update({
      where: { id },
      data: {
        sku: input.sku,
        name: input.name,
        category: input.category ?? null,
        ...(input.subStore ? { subStore: input.subStore } : {}),
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
  return { ok: true };
}

export async function deactivateIngredient(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(CATALOG_ROLES);
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
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function reactivateIngredient(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(CATALOG_ROLES);
    await db.$transaction(async (tx) => {
      await tx.ingredient.update({ where: { id }, data: { active: true } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "INGREDIENT_REACTIVATED",
          entity: "Ingredient",
          entityId: id,
        },
      });
    });
    revalidatePath("/inventory/ingredients");
    revalidatePath(`/inventory/ingredients/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Record a receipt and apply moving-average to the ingredient.
 *   newQty  = onHand + receiptQty
 *   newAvg  = (onHand * avg + receiptQty * receiptUnitCost) / newQty
 *
 * Both updates happen in the same transaction, with an AuditLog row.
 */
export async function recordIngredientReceipt(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordIngredientReceiptInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordIngredientReceiptInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = IngredientReceiptInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    await lockIngredientRow(tx, input.ingredientId);
    const ingredient = await tx.ingredient.findUnique({ where: { id: input.ingredientId } });
    if (!ingredient) throw new ActionError("Ingredient not found");

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
        recordedById: session.user.id,
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
  return { ok: true, id: result.id };
}

/**
 * Direct issue path (for emergencies / out-of-band consumption). Most issues
 * arrive via the chef-requisition flow (see chef-requisitions.ts:issueChefRequisitionLine)
 * which calls the same primitive. Decrements onHandQty; never touches avgUnitCost
 * (moving-average is for receipts only). Refuses to issue if it would make
 * stock negative.
 */
export async function recordDirectIngredientIssue(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordDirectIngredientIssueInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordDirectIngredientIssueInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = IngredientIssueInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    await lockIngredientRow(tx, input.ingredientId);
    const ingredient = await tx.ingredient.findUnique({ where: { id: input.ingredientId } });
    if (!ingredient) throw new ActionError("Ingredient not found");

    const issueQty = toDecimal(input.qty);
    const onHand = toDecimal(ingredient.onHandQty);
    if (issueQty.lte(0)) throw new ActionError("Issue quantity must be positive");
    if (issueQty.gt(onHand)) {
      throw new ActionError(
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
  return { ok: true, id: result.id };
}

/**
 * Manual stock adjustment — admin/manager only. Use for write-offs,
 * spoilage, opening-balance corrections, and any quantity change that
 * isn't a purchase or an issue. Does NOT touch avgUnitCost (corrections
 * are quantity-only by design; changing valuation requires a re-receipt).
 *
 * Caller provides either `newQty` (absolute target) or `delta` (signed
 * change); we resolve to the same end state and record both for audit.
 */
export async function adjustIngredientStock(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await adjustIngredientStockInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function adjustIngredientStockInner(raw: unknown): Promise<{ ok: true; id: string }> {
  // Admin toggle (Admin → Settings → stock.storeDirectEdit): during the
  // stock-loading phase the store keeper may set on-hand directly.
  const directEdit = await getSettingOr<boolean>("stock.storeDirectEdit", false);
  const session = await requireRole(
    directEdit ? [...ADJUST_ROLES, Role.STORE_KEEPER] : ADJUST_ROLES,
  );
  const input = IngredientAdjustmentInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    await lockIngredientRow(tx, input.ingredientId);
    const ingredient = await tx.ingredient.findUnique({ where: { id: input.ingredientId } });
    if (!ingredient) throw new ActionError("Ingredient not found");

    const before = toDecimal(ingredient.onHandQty);
    const after = input.newQty !== undefined ? toDecimal(input.newQty) : before.plus(toDecimal(input.delta!));
    if (after.lt(0)) throw new ActionError("Adjusted on-hand cannot be negative");
    const delta = after.minus(before);
    if (delta.eq(0)) throw new ActionError("No change — adjusted quantity matches current on-hand");

    const adj = await tx.ingredientAdjustment.create({
      data: {
        ingredientId: input.ingredientId,
        delta: delta.toDecimalPlaces(3).toString(),
        beforeQty: before.toDecimalPlaces(3).toString(),
        afterQty: after.toDecimalPlaces(3).toString(),
        reason: input.reason,
        note: input.note ?? null,
        adjustedById: session.user.id,
      },
    });

    await tx.ingredient.update({
      where: { id: input.ingredientId },
      data: { onHandQty: after.toDecimalPlaces(3).toString() },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_STOCK_ADJUSTED",
        entity: "IngredientAdjustment",
        entityId: adj.id,
        payloadHash: sha256Json({
          ingredientId: input.ingredientId,
          before: before.toString(),
          after: after.toString(),
          delta: delta.toString(),
          reason: input.reason,
        }),
      },
    });
    return adj;
  });

  revalidatePath("/inventory/ingredients");
  revalidatePath("/inventory/adjustments");
  revalidatePath(`/inventory/ingredients/${input.ingredientId}`);
  return { ok: true, id: result.id };
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
    include: {
      ingredient: { select: { name: true, sku: true, unit: true } },
      recordedBy: { select: { name: true } },
    },
  });
}

// Stock-adjustment audit list — admin/manager only.
export async function listRecentAdjustments(opts: { limit?: number } = {}) {
  await requireRole(ADJUST_ROLES);
  return db.ingredientAdjustment.findMany({
    orderBy: { adjustedAt: "desc" },
    take: opts.limit ?? 100,
    include: {
      ingredient: { select: { name: true, sku: true, unit: true } },
      adjustedBy: { select: { name: true } },
    },
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
