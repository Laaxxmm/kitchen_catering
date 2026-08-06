"use server";

import { revalidatePath } from "next/cache";
import { Role, StockStore, type Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  IngredientAdjustmentInput,
  IngredientInput,
  IngredientReceiptInput,
  IngredientIssueInput,
  IngredientReturnInput,
} from "@/lib/validators";
import { nextGPItemCode } from "@/lib/sequences";
import { newMovingAverage } from "@/lib/inventory-cost";
import { STORE_LABELS, checkReturnQty, remainingReturnable } from "@/lib/stock-movement";
import { unitsEquivalent } from "@/lib/units";
import { istToUtc } from "@/lib/time";
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
// Maintaining EXISTING catalogue entries (edit / deactivate / reorder level)
// stays broad — the store and the chef curate the items they work with daily.
const CATALOG_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD];
// CREATING a new ingredient is management-only. Letting the store and chef
// add items produced duplicates of the same ingredient under different names
// and units, which then stranded GRNs and corrupted stock — so a new item is
// now a deliberate management decision.
const CATALOG_CREATE_ROLES = [Role.ADMIN, Role.MANAGER];
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
  const session = await requireRole(CATALOG_CREATE_ROLES);
  const input = IngredientInput.parse(raw);

  // Block duplicate NAMES (case-insensitive). Two ingredients with the
  // same name silently split stock — goods received on one are invisible to a
  // requisition pointing at the other (the "1150 received, 0 on hand" bug).
  // Force reuse of the existing item instead of a twin.
  const nameDupe = await db.ingredient.findFirst({
    where: { name: { equals: input.name.trim(), mode: "insensitive" } },
    select: { sku: true, active: true },
  });
  if (nameDupe) {
    throw new ActionError(
      nameDupe.active
        ? `An ingredient named "${input.name.trim()}" already exists (${nameDupe.sku}). Pick it from the list instead of adding a new one.`
        : `A hidden ingredient named "${input.name.trim()}" already exists (${nameDupe.sku}). Unhide it from Kitchen stock → Show hidden items instead of adding a new one.`,
    );
  }

  const row = await db.$transaction(async (tx) => {
    // Code is assigned, never typed — the whole point of GP codes is that
    // nobody invents an identifier for an item that already exists.
    const sku = await nextGPItemCode(tx);
    const created = await tx.ingredient.create({
      data: {
        sku,
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
        payloadHash: sha256Json({ sku, name: input.name }),
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
        // No sku: a GP code is permanent once assigned.
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
  // ACCOUNTS records books-side receipts — matches the /inventory/receipts
  // middleware rule ("store + accounts"). Issues stay store-only (L1).
  const session = await requireRole([...WRITE_ROLES, Role.ACCOUNTS]);
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
 * Stock coming back from the kitchen — the chef drew 5 kg of onions and used
 * 3. The store's F&B counterpart is recordBanquetReturn (banquet.ts); this is
 * the kitchen version, with the one thing food cost needs that cutlery
 * doesn't: money.
 *
 * A line names the IngredientIssue it reverses, so both the order credited
 * and the unit cost credited come from that issue. Valuing the return at
 * today's moving average instead would silently re-price inventory and leave
 * the event's cost only partly reversed. The quantity is capped at what that
 * issue still has outstanding (issued − already returned), and the stock goes
 * back on hand inside the same transaction as the document, under the same
 * row lock the issue path takes.
 */
export async function recordIngredientReturn(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordIngredientReturnInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordIngredientReturnInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = IngredientReturnInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const issueIds = [...new Set(input.lines.map((l) => l.issueId))];
    const issues = await tx.ingredientIssue.findMany({
      where: { id: { in: issueIds } },
      select: {
        id: true,
        qty: true,
        unitCostAtIssue: true,
        ingredientId: true,
        ingredient: { select: { name: true, unit: true } },
      },
    });
    if (issues.length !== issueIds.length) {
      throw new ActionError("One of those issues no longer exists — refresh and try again.");
    }
    const issueById = new Map(issues.map((i) => [i.id, i]));
    const ingredientIds = [...new Set(issues.map((i) => i.ingredientId))].sort();

    // Lock every ingredient the document touches BEFORE reading stock or
    // prior returns; ids in a stable order so two multi-line returns can't
    // deadlock against each other.
    for (const id of ingredientIds) await lockIngredientRow(tx, id);

    const [prior, ingredients] = await Promise.all([
      tx.ingredientReturnLine.groupBy({
        by: ["issueId"],
        where: { issueId: { in: issueIds } },
        _sum: { quantity: true },
      }),
      tx.ingredient.findMany({
        where: { id: { in: ingredientIds } },
        select: { id: true, onHandQty: true, avgUnitCost: true },
      }),
    ]);
    const returnedBy = new Map(prior.map((p) => [p.issueId, toDecimal(p._sum.quantity ?? 0)]));

    // Two lines against the same issue share one ceiling — check the total,
    // not each line, or a split return walks straight past the cap.
    const wantByIssue = new Map<string, Decimal>();
    for (const l of input.lines) {
      const want = toDecimal(l.quantity || "0");
      if (want.lte(0)) throw new ActionError("Return quantity must be greater than 0");
      wantByIssue.set(l.issueId, (wantByIssue.get(l.issueId) ?? new Decimal(0)).plus(want));
    }
    for (const [issueId, want] of wantByIssue) {
      const issue = issueById.get(issueId)!;
      const refusal = checkReturnQty({
        want,
        issuedQty: issue.qty.toString(),
        alreadyReturned: returnedBy.get(issueId) ?? "0",
        name: issue.ingredient.name,
        unit: issue.ingredient.unit,
      });
      if (refusal) throw new ActionError(refusal);
    }

    const created = await tx.ingredientReturn.create({
      data: {
        returnedAt: istToUtc(input.returnedAt),
        recordedById: session.user.id,
        notes: input.notes?.trim() || null,
        lines: {
          create: input.lines.map((l) => ({
            issueId: l.issueId,
            quantity: toDecimal(l.quantity).toDecimalPlaces(3).toString(),
            unitCost: issueById.get(l.issueId)!.unitCostAtIssue.toString(),
            reason: l.reason.trim(),
          })),
        },
      },
    });

    // Fold each line back into stock at the cost it left at. Several lines can
    // hit one ingredient at different issue costs, so the average is
    // recomputed line by line off a running figure, then written once.
    const running = new Map(
      ingredients.map((i) => [i.id, { qty: toDecimal(i.onHandQty), avg: toDecimal(i.avgUnitCost) }]),
    );
    for (const l of input.lines) {
      const issue = issueById.get(l.issueId)!;
      const cur = running.get(issue.ingredientId)!;
      const next = newMovingAverage({
        onHandQty: cur.qty,
        avgUnitCost: cur.avg,
        receiptQty: toDecimal(l.quantity),
        receiptUnitCost: issue.unitCostAtIssue.toString(),
      });
      running.set(issue.ingredientId, { qty: next.qty, avg: next.avgUnitCost });
    }
    for (const [ingredientId, v] of running) {
      await tx.ingredient.update({
        where: { id: ingredientId },
        data: {
          onHandQty: v.qty.toDecimalPlaces(3).toString(),
          avgUnitCost: v.avg.toDecimalPlaces(4).toString(),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_RETURN_RECORDED",
        entity: "IngredientReturn",
        entityId: created.id,
        payloadHash: sha256Json({
          lines: input.lines.map((l) => ({ issueId: l.issueId, qty: l.quantity, reason: l.reason })),
        }),
      },
    });
    return created;
  });

  revalidatePath("/inventory/ingredients");
  revalidatePath("/inventory/issues");
  revalidatePath("/inventory/returns");
  return { ok: true, id: result.id };
}

/**
 * Issues that still have something returnable, for the return screen's
 * picker. Scoped to an order when the store keeper came from one.
 */
export async function listReturnableIssues(opts: { orderId?: string; limit?: number } = {}) {
  await requireRole(WRITE_ROLES);
  const issues = await db.ingredientIssue.findMany({
    where: opts.orderId ? { orderId: opts.orderId } : {},
    orderBy: { issuedAt: "desc" },
    // ponytail: recent-window scan, not a "still returnable" SQL predicate —
    // returns happen within days of the issue. Push the filter into SQL if
    // someone starts returning stock from months back.
    take: opts.limit ?? 200,
    include: {
      ingredient: { select: { name: true, sku: true, unit: true } },
      order: { select: { code: true } },
      returnLines: { select: { quantity: true } },
    },
  });
  return issues
    .map((i) => {
      const returned = i.returnLines.reduce((s, l) => s.plus(toDecimal(l.quantity)), new Decimal(0));
      return {
        id: i.id,
        issuedAt: i.issuedAt,
        ingredientName: i.ingredient.name,
        sku: i.ingredient.sku,
        unit: i.ingredient.unit,
        orderId: i.orderId,
        orderCode: i.order?.code ?? null,
        issuedQty: i.qty.toString(),
        unitCostAtIssue: i.unitCostAtIssue.toString(),
        returnable: remainingReturnable(i.qty.toString(), returned).toString(),
      };
    })
    .filter((i) => toDecimal(i.returnable).gt(0));
}

export async function listRecentReturns(opts: { limit?: number } = {}) {
  await requireRole(READ_ROLES);
  return db.ingredientReturn.findMany({
    orderBy: { returnedAt: "desc" },
    take: opts.limit ?? 50,
    include: {
      recordedBy: { select: { name: true } },
      lines: {
        include: {
          issue: {
            select: {
              ingredient: { select: { name: true, unit: true } },
              order: { select: { id: true, code: true } },
            },
          },
        },
      },
    },
  });
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

/**
 * Merge a duplicate ingredient (SOURCE) into the keeper (TARGET). Duplicate
 * names silently split stock — goods received on one twin are invisible to a
 * requisition pointing at the other. This folds the source's stock into the
 * target (weighted average, treating it as a receipt), re-points every table
 * that references the source, and retires the source (kept for the audit
 * trail, not deleted). Admin/manager only — this is a destructive catalogue
 * op, not a storekeeper stock movement.
 */
export async function mergeIngredient(sourceId: string, targetId: string): Promise<ActionResult> {
  try {
    return await mergeIngredientInner(sourceId, targetId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function mergeIngredientInner(sourceId: string, targetId: string): Promise<{ ok: true }> {
  const session = await requireRole([Role.ADMIN, Role.MANAGER]);
  if (sourceId === targetId) throw new ActionError("Pick two different items to merge.");

  await db.$transaction(async (tx) => {
    // Lock both rows — the fold reads+writes target.onHandQty like a receipt
    // does, so it needs the same serialisation. Sorted order avoids a deadlock
    // if two merges touch the same pair from opposite directions.
    for (const id of [sourceId, targetId].sort()) await lockIngredientRow(tx, id);

    const [source, target] = await Promise.all([
      tx.ingredient.findUnique({ where: { id: sourceId } }),
      tx.ingredient.findUnique({ where: { id: targetId } }),
    ]);
    if (!source) throw new ActionError("Source ingredient not found");
    if (!target) throw new ActionError("Target ingredient not found");

    // Merging across units numerically corrupts stock, cost and every open
    // line (5 pkt folded into kg becomes 5 kg) — refuse (AUDIT_REPORT M20).
    if (!unitsEquivalent(source.unit, target.unit)) {
      throw new ActionError(
        `These items are tracked in different units (${source.unit} vs ${target.unit}) — align the units first, then merge.`,
      );
    }

    // a. Fold source stock into target (source on-hand = a receipt into target).
    //    newMovingAverage rejects a zero receipt qty, so an empty source is a
    //    no-op on the target's cost/qty.
    if (toDecimal(source.onHandQty).gt(0)) {
      const { qty, avgUnitCost } = newMovingAverage({
        onHandQty: target.onHandQty,
        avgUnitCost: target.avgUnitCost,
        receiptQty: source.onHandQty,
        receiptUnitCost: source.avgUnitCost,
      });
      await tx.ingredient.update({
        where: { id: targetId },
        data: {
          onHandQty: qty.toDecimalPlaces(3).toString(),
          avgUnitCost: avgUnitCost.toDecimalPlaces(4).toString(),
        },
      });
    }

    // b. Re-point every reference source → target. None of these tables has a
    //    unique on ingredientId, so a plain updateMany can't collide.
    const where = { where: { ingredientId: sourceId }, data: { ingredientId: targetId } };
    await tx.ingredientReceipt.updateMany(where);
    await tx.ingredientIssue.updateMany(where);
    await tx.ingredientAdjustment.updateMany(where);
    await tx.recipeIngredient.updateMany(where);
    await tx.purchaseRequisitionLine.updateMany(where);
    await tx.orderBudgetLine.updateMany(where);
    await tx.vendorPOLine.updateMany(where);
    await tx.chefRequisitionLine.updateMany(where);

    // c. Retire the source — its stock now lives on the target. Keep the row
    //    (audit trail); never delete.
    await tx.ingredient.update({ where: { id: sourceId }, data: { active: false, onHandQty: "0" } });

    // d. Audit.
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_MERGED",
        entity: "Ingredient",
        entityId: targetId,
        payloadHash: sha256Json({
          sourceId,
          sourceSku: source.sku,
          targetSku: target.sku,
          movedQty: source.onHandQty.toString(),
        }),
      },
    });
  });

  revalidatePath("/inventory/ingredients");
  revalidatePath(`/inventory/ingredients/${sourceId}`);
  revalidatePath(`/inventory/ingredients/${targetId}`);
  return { ok: true };
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
    // High cap so the full catalogue shows in requisition / PO pickers — the
    // 300 default silently hid later items once the catalogue grew past it.
    take: 2000,
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
  // Reading the adjustments log is open to the store keeper too — they
  // can hold the write permission via the stock.storeDirectEdit toggle,
  // and the list is their receipt of what they changed.
  await requireRole([...ADJUST_ROLES, Role.STORE_KEEPER]);
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

/**
 * Per-ingredient movement ledger for the detail page: every receipt (+),
 * issue (−), kitchen return (+), store transfer (±) and manual adjustment (±)
 * in one reverse-chronological list, capped at the latest 100 entries.
 * Read-only, same gate as the other inventory reads.
 *
 * Every movement that touches onHandQty belongs here — a ledger missing one
 * of them no longer adds up to the stock figure it sits under.
 */
export type IngredientMovementEntry = {
  kind: "RECEIPT" | "ISSUE" | "RETURN" | "TRANSFER" | "ADJUSTMENT";
  id: string;
  at: Date;
  /** Signed quantity string, e.g. "+12.5" / "-3". */
  qty: string;
  /** Who recorded it, where the source row tracks a user. */
  by: string | null;
  /** Human context: cost + supplier / order + purpose / reason. */
  detail: string;
};

const MOVEMENT_CAP = 100;

export async function listIngredientMovements(
  ingredientId: string,
): Promise<IngredientMovementEntry[]> {
  await requireRole(READ_ROLES);
  const [receipts, issues, returns, transfers, adjustments] = await Promise.all([
    db.ingredientReceipt.findMany({
      where: { ingredientId },
      orderBy: { receivedAt: "desc" },
      take: MOVEMENT_CAP,
      include: { recordedBy: { select: { name: true } } },
    }),
    db.ingredientIssue.findMany({
      where: { ingredientId },
      orderBy: { issuedAt: "desc" },
      take: MOVEMENT_CAP,
      include: {
        issuedBy: { select: { name: true } },
        order: { select: { code: true } },
      },
    }),
    db.ingredientReturnLine.findMany({
      where: { issue: { ingredientId } },
      orderBy: { return: { returnedAt: "desc" } },
      take: MOVEMENT_CAP,
      include: {
        return: { include: { recordedBy: { select: { name: true } } } },
        issue: { select: { order: { select: { code: true } } } },
      },
    }),
    // Transfers reference items polymorphically (no FK), so both directions
    // are matched on the plain id plus the store it belongs to.
    db.stockTransfer.findMany({
      where: {
        OR: [
          { fromStore: StockStore.KITCHEN, fromItemId: ingredientId },
          { toStore: StockStore.KITCHEN, toItemId: ingredientId },
        ],
      },
      orderBy: { transferredAt: "desc" },
      take: MOVEMENT_CAP,
      include: { recordedBy: { select: { name: true } } },
    }),
    db.ingredientAdjustment.findMany({
      where: { ingredientId },
      orderBy: { adjustedAt: "desc" },
      take: MOVEMENT_CAP,
      include: { adjustedBy: { select: { name: true } } },
    }),
  ]);

  const rows: IngredientMovementEntry[] = [
    ...receipts.map((r) => ({
      kind: "RECEIPT" as const,
      id: r.id,
      at: r.receivedAt,
      qty: `+${r.qty.toString()}`,
      by: r.recordedBy?.name ?? null,
      detail: [
        `₹${r.unitCost.toString()}/unit`,
        r.supplier ? `from ${r.supplier}` : null,
        r.note,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...issues.map((i) => ({
      kind: "ISSUE" as const,
      id: i.id,
      at: i.issuedAt,
      qty: `-${i.qty.toString()}`,
      by: i.issuedBy.name,
      detail: [i.order ? `order ${i.order.code}` : "no order", i.note]
        .filter(Boolean)
        .join(" · "),
    })),
    ...returns.map((r) => ({
      kind: "RETURN" as const,
      id: r.id,
      at: r.return.returnedAt,
      qty: `+${r.quantity.toString()}`,
      by: r.return.recordedBy.name,
      detail: [
        `₹${r.unitCost.toString()}/unit credited back`,
        r.issue.order ? `order ${r.issue.order.code}` : "no order",
        r.reason,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...transfers.map((t) => {
      const out = t.fromStore === StockStore.KITCHEN && t.fromItemId === ingredientId;
      return {
        kind: "TRANSFER" as const,
        id: t.id,
        at: t.transferredAt,
        qty: `${out ? "-" : "+"}${t.quantity.toString()}`,
        by: t.recordedBy.name,
        detail: [
          out ? `to ${STORE_LABELS[t.toStore]}: ${t.toItemName}` : `from ${STORE_LABELS[t.fromStore]}: ${t.fromItemName}`,
          t.notes,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }),
    ...adjustments.map((a) => ({
      kind: "ADJUSTMENT" as const,
      id: a.id,
      at: a.adjustedAt,
      qty: toDecimal(a.delta).gte(0) ? `+${a.delta.toString()}` : a.delta.toString(),
      by: a.adjustedBy.name,
      detail: [a.reason, a.note].filter(Boolean).join(" · "),
    })),
  ];
  rows.sort((x, y) => y.at.getTime() - x.at.getTime());
  return rows.slice(0, MOVEMENT_CAP);
}
