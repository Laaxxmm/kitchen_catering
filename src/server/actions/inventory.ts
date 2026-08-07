"use server";

import { revalidatePath } from "next/cache";
import { IngredientReturnStatus, Role, StockStore, type Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  IngredientAdjustmentInput,
  IngredientInput,
  IngredientReceiptInput,
  IngredientIssueInput,
  IngredientReturnInput,
  IngredientReturnConfirmInput,
  IngredientReturnDeclarationInput,
} from "@/lib/validators";
import { nextGPItemCode } from "@/lib/sequences";
import { newMovingAverage } from "@/lib/inventory-cost";
import { STORE_LABELS, checkDeclareQty, checkReturnQty, remainingReturnable } from "@/lib/stock-movement";
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
// Also the set that CONFIRMS a kitchen return declaration, because
// confirming is what moves the stock.
const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];
// Declaring a kitchen return — the chef says what they're sending back.
// Moves nothing, so it is deliberately NOT the stock-write set.
const DECLARE_ROLES = [Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD];
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
 * How much has actually COME BACK against each issue, per issue id.
 *
 * CONFIRMED only, and that filter is the whole safety story of the
 * declaration flow: a DECLARED document is a promise the store hasn't met
 * yet and a REJECTED one is a promise that died — neither has ever touched
 * Ingredient.onHandQty, so counting either as returned stock would let the
 * next real return be refused, or (worse, read the other way round) let
 * stock be conjured. Everything that measures "what came back" goes through
 * this function.
 */
async function confirmedReturnedByIssue(
  tx: Prisma.TransactionClient,
  issueIds: string[],
): Promise<Map<string, Decimal>> {
  const rows = await tx.ingredientReturnLine.groupBy({
    by: ["issueId"],
    where: {
      issueId: { in: issueIds },
      return: { status: IngredientReturnStatus.CONFIRMED },
    },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.issueId, toDecimal(r._sum.quantity ?? 0)]));
}

/**
 * Fold returned lines back into stock at the cost they left at. Several
 * lines can hit one ingredient at different issue costs, so the average is
 * recomputed line by line off a running figure, then written once.
 *
 * Shared by both routes into a return — the store's direct counter entry and
 * the store's confirmation of a chef's declaration — so the two can never
 * drift into valuing the same movement differently. Callers must already
 * hold the ingredient row locks.
 */
async function foldReturnedStockOnHand(
  tx: Prisma.TransactionClient,
  lines: readonly { ingredientId: string; quantity: Decimal; unitCost: string }[],
) {
  if (lines.length === 0) return;
  const ingredientIds = [...new Set(lines.map((l) => l.ingredientId))];
  const ingredients = await tx.ingredient.findMany({
    where: { id: { in: ingredientIds } },
    select: { id: true, onHandQty: true, avgUnitCost: true },
  });
  const running = new Map(
    ingredients.map((i) => [i.id, { qty: toDecimal(i.onHandQty), avg: toDecimal(i.avgUnitCost) }]),
  );
  for (const l of lines) {
    const cur = running.get(l.ingredientId)!;
    const next = newMovingAverage({
      onHandQty: cur.qty,
      avgUnitCost: cur.avg,
      receiptQty: l.quantity,
      receiptUnitCost: l.unitCost,
    });
    running.set(l.ingredientId, { qty: next.qty, avg: next.avgUnitCost });
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
        orderId: true,
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

    const returnedBy = await confirmedReturnedByIssue(tx, issueIds);

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
        // The store recorded it at the counter with no declaration behind
        // it — recorder and confirmer are the same person, and the stock
        // moves in this same transaction.
        status: IngredientReturnStatus.CONFIRMED,
        returnedAt: istToUtc(input.returnedAt),
        recordedById: session.user.id,
        confirmedById: session.user.id,
        confirmedAt: new Date(),
        notes: input.notes?.trim() || null,
        lines: {
          create: input.lines.map((l) => ({
            issueId: l.issueId,
            quantity: toDecimal(l.quantity).toDecimalPlaces(3).toString(),
            // No declaration behind this line — NULL is the truth.
            declaredQuantity: null,
            unitCost: issueById.get(l.issueId)!.unitCostAtIssue.toString(),
            reason: l.reason.trim(),
          })),
        },
      },
    });

    await foldReturnedStockOnHand(
      tx,
      input.lines.map((l) => ({
        ingredientId: issueById.get(l.issueId)!.ingredientId,
        quantity: toDecimal(l.quantity),
        unitCost: issueById.get(l.issueId)!.unitCostAtIssue.toString(),
      })),
    );

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
    return { created, orderIds: [...new Set(issues.map((i) => i.orderId).filter((o): o is string => o != null))] };
  });

  revalidatePath("/inventory/ingredients");
  revalidatePath("/inventory/issues");
  revalidatePath("/inventory/returns");
  revalidatePath("/dashboard");
  // The order pages show what came back for the event — refresh each one the
  // document touched.
  for (const orderId of result.orderIds) revalidatePath(`/orders/${orderId}`);
  return { ok: true, id: result.created.id };
}

// ─── Chef declares → store confirms ──────────────────────────────────────
//
// The custody handover the client asked for. The chef tells the store what
// they are sending back; the store confirms what physically turned up,
// correcting the quantity where the two differ, and only that confirmation
// moves stock. Both figures are kept: a declaration's `declaredQuantity` is
// written once and never touched again, so "declared 2 kg, received 1.5 kg"
// survives — which is the discrepancy the old one-step path absorbed in
// silence.
//
// The store's direct counter path above is untouched. Stock does arrive
// without a declaration, and making the store invent one to book it in
// would be worse than the problem. Both routes end in the same
// `foldReturnedStockOnHand` and the same ceiling.

/**
 * The chef declaring what they are sending back to the store. Writes a
 * DECLARED document and NOTHING else: no stock moves, no cost reverses, no
 * order is credited until the store confirms it.
 *
 * Gate: KITCHEN_HEAD + management. Deliberately not the stock-write set —
 * a declaration is a statement of intent, not a movement.
 */
export async function declareIngredientReturn(
  raw: unknown,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await declareIngredientReturnInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function declareIngredientReturnInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(DECLARE_ROLES);
  const input = IngredientReturnDeclarationInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const issueIds = [...new Set(input.lines.map((l) => l.issueId))];
    const issues = await tx.ingredientIssue.findMany({
      where: { id: { in: issueIds } },
      select: {
        id: true,
        qty: true,
        unitCostAtIssue: true,
        orderId: true,
        ingredient: { select: { name: true, unit: true } },
      },
    });
    if (issues.length !== issueIds.length) {
      throw new ActionError("One of those issues no longer exists — refresh and try again.");
    }
    const issueById = new Map(issues.map((i) => [i.id, i]));

    // No ingredient row lock here, on purpose: this writes no stock, so
    // there is nothing for a lock to protect, and taking one would block
    // real receipts and issues for the duration. The worst a race can do is
    // let two declarations queue up past the ceiling — and confirmation
    // re-checks against confirmed movements under the lock before anything
    // moves, so the ledger is still safe.
    const [returnedBy, pendingRows] = await Promise.all([
      confirmedReturnedByIssue(tx, issueIds),
      tx.ingredientReturnLine.groupBy({
        by: ["issueId"],
        where: {
          issueId: { in: issueIds },
          return: { status: IngredientReturnStatus.DECLARED },
        },
        _sum: { quantity: true },
      }),
    ]);
    const declaredBy = new Map(pendingRows.map((p) => [p.issueId, toDecimal(p._sum.quantity ?? 0)]));

    // Normalise every quantity ONCE, here, and use that figure from here on.
    // `decimalString` permits "" and `new Decimal("")` throws, so the blank
    // guard has to sit before the first Decimal and the row that gets
    // written has to reuse the guarded value rather than re-parsing the raw
    // input further down.
    const qtyByLine = input.lines.map((l) => {
      const raw = (l.quantity ?? "").toString().trim();
      if (raw === "") throw new ActionError("Return quantity must be greater than 0");
      const want = toDecimal(raw).toDecimalPlaces(3);
      if (want.lte(0)) throw new ActionError("Return quantity must be greater than 0");
      return want;
    });

    // Several lines against one issue share one ceiling — total them first,
    // exactly as the direct path does.
    const wantByIssue = new Map<string, Decimal>();
    input.lines.forEach((l, idx) => {
      wantByIssue.set(
        l.issueId,
        (wantByIssue.get(l.issueId) ?? new Decimal(0)).plus(qtyByLine[idx]),
      );
    });
    for (const [issueId, want] of wantByIssue) {
      const issue = issueById.get(issueId)!;
      const refusal = checkDeclareQty({
        want,
        issuedQty: issue.qty.toString(),
        alreadyReturned: returnedBy.get(issueId) ?? "0",
        alreadyDeclared: declaredBy.get(issueId) ?? "0",
        name: issue.ingredient.name,
        unit: issue.ingredient.unit,
      });
      if (refusal) throw new ActionError(refusal);
    }

    const created = await tx.ingredientReturn.create({
      data: {
        status: IngredientReturnStatus.DECLARED,
        returnedAt: istToUtc(input.returnedAt),
        recordedById: session.user.id,
        notes: input.notes?.trim() || null,
        lines: {
          create: input.lines.map((l, idx) => {
            const qty = qtyByLine[idx].toString();
            return {
              issueId: l.issueId,
              // Both start at the declared figure. `quantity` is what this
              // document is currently for; confirmation overwrites it with
              // what arrived and leaves `declaredQuantity` alone.
              quantity: qty,
              declaredQuantity: qty,
              unitCost: issueById.get(l.issueId)!.unitCostAtIssue.toString(),
              reason: l.reason.trim(),
            };
          }),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_RETURN_DECLARED",
        entity: "IngredientReturn",
        entityId: created.id,
        payloadHash: sha256Json({
          lines: input.lines.map((l) => ({ issueId: l.issueId, qty: l.quantity, reason: l.reason })),
        }),
      },
    });
    return {
      id: created.id,
      orderIds: [...new Set(issues.map((i) => i.orderId).filter((o): o is string => o != null))],
    };
  });

  revalidatePath("/inventory/returns");
  revalidatePath("/dashboard");
  for (const orderId of result.orderIds) revalidatePath(`/orders/${orderId}`);
  return { ok: true, id: result.id };
}

/**
 * The store confirming a declaration: what actually turned up at the
 * counter, line by line. THIS is where stock moves and the order is
 * credited — through the same ceiling and the same costing as the direct
 * path, neither weakened nor bypassed.
 *
 * A line may be confirmed at 0 ("the chef declared it, nothing arrived");
 * the declared figure stays on the row so the discrepancy is readable.
 *
 * Gate: WRITE_ROLES — unchanged from the direct path.
 */
export async function confirmIngredientReturn(raw: unknown): Promise<ActionResult> {
  try {
    return await confirmIngredientReturnInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function confirmIngredientReturnInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = IngredientReturnConfirmInput.parse(raw);
  const confirmedAt = new Date();

  const result = await db.$transaction(async (tx) => {
    const doc = await tx.ingredientReturn.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        status: true,
        lines: {
          select: {
            id: true,
            issueId: true,
            issue: {
              select: {
                id: true,
                qty: true,
                unitCostAtIssue: true,
                ingredientId: true,
                orderId: true,
                ingredient: { select: { name: true, unit: true } },
              },
            },
          },
        },
      },
    });
    if (!doc) {
      throw new ActionError("That declaration no longer exists — refresh and try again.");
    }
    if (doc.status !== IngredientReturnStatus.DECLARED) {
      throw new ActionError(
        doc.status === IngredientReturnStatus.CONFIRMED
          ? "This return has already been confirmed — the stock is back on hand."
          : "This declaration was turned down and can't be confirmed.",
      );
    }

    // Every line must be answered — a silent omission would book part of a
    // handover and leave the rest in limbo.
    const lineById = new Map(doc.lines.map((l) => [l.id, l]));
    const received = new Map<string, Decimal>();
    for (const l of input.lines) {
      const line = lineById.get(l.lineId);
      if (!line) throw new ActionError("That declaration changed — refresh and try again.");
      // The validator already refused "" and negatives, so this is safe to
      // hand to Decimal.
      received.set(l.lineId, toDecimal(l.receivedQty).toDecimalPlaces(3));
    }
    if (received.size !== doc.lines.length) {
      throw new ActionError("Say what arrived for every line before confirming.");
    }

    const ingredientIds = [...new Set(doc.lines.map((l) => l.issue.ingredientId))].sort();
    for (const id of ingredientIds) await lockIngredientRow(tx, id);

    // Ceiling, re-read under the lock and against CONFIRMED movements only —
    // the same guard the direct path uses, on the same numbers. This
    // document is still DECLARED, so it isn't counted against itself.
    const issueIds = [...new Set(doc.lines.map((l) => l.issueId))];
    const returnedBy = await confirmedReturnedByIssue(tx, issueIds);
    const wantByIssue = new Map<string, Decimal>();
    for (const line of doc.lines) {
      const qty = received.get(line.id)!;
      if (qty.lte(0)) continue; // nothing arrived on this line — nothing to cap
      wantByIssue.set(line.issueId, (wantByIssue.get(line.issueId) ?? new Decimal(0)).plus(qty));
    }
    for (const [issueId, want] of wantByIssue) {
      const issue = doc.lines.find((l) => l.issueId === issueId)!.issue;
      const refusal = checkReturnQty({
        want,
        issuedQty: issue.qty.toString(),
        alreadyReturned: returnedBy.get(issueId) ?? "0",
        name: issue.ingredient.name,
        unit: issue.ingredient.unit,
      });
      if (refusal) throw new ActionError(refusal);
    }

    // Guarded transition: a second store keeper on a stale tab loses the
    // race here instead of double-booking the stock.
    const flipped = await tx.ingredientReturn.updateMany({
      where: { id: doc.id, status: IngredientReturnStatus.DECLARED },
      data: {
        status: IngredientReturnStatus.CONFIRMED,
        confirmedById: session.user.id,
        confirmedAt,
        confirmationNote: input.note?.trim() || null,
      },
    });
    if (flipped.count === 0) {
      throw new ActionError("This declaration just changed — refresh the page.");
    }

    // `declaredQuantity` is untouched: only `quantity` moves to what arrived.
    for (const line of doc.lines) {
      await tx.ingredientReturnLine.update({
        where: { id: line.id },
        data: { quantity: received.get(line.id)!.toString() },
      });
    }

    await foldReturnedStockOnHand(
      tx,
      doc.lines
        .filter((l) => received.get(l.id)!.gt(0))
        .map((l) => ({
          ingredientId: l.issue.ingredientId,
          quantity: received.get(l.id)!,
          unitCost: l.issue.unitCostAtIssue.toString(),
        })),
    );

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INGREDIENT_RETURN_CONFIRMED",
        entity: "IngredientReturn",
        entityId: doc.id,
        payloadHash: sha256Json({
          lines: doc.lines.map((l) => ({ lineId: l.id, received: received.get(l.id)!.toString() })),
        }),
      },
    });
    return {
      orderIds: [...new Set(doc.lines.map((l) => l.issue.orderId).filter((o): o is string => o != null))],
    };
  });

  revalidatePath("/inventory/ingredients");
  revalidatePath("/inventory/issues");
  revalidatePath("/inventory/returns");
  revalidatePath("/dashboard");
  for (const orderId of result.orderIds) revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

/**
 * Turn down a declaration before anything moves — the store saying nothing
 * turned up, or the chef withdrawing what they said they'd send.
 *
 * One state covers both, because the difference is already stored and
 * exact: `rejectedById === recordedById` means the declarer withdrew it,
 * anyone else means the store refused it. A reason is required either way —
 * "2 kg of paneer was declared and never arrived" is precisely the kind of
 * gap this flow exists to leave a trace of.
 *
 * Gate: the confirm set, plus the chef who wrote it (their own row only).
 */
export async function rejectIngredientReturnDeclaration(
  id: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const session = await requireRole([...WRITE_ROLES, Role.KITCHEN_HEAD]);
    const trimmed = reason?.trim() ?? "";
    if (!trimmed) throw new ActionError("Say why this declaration is being turned down.");
    const rejectedAt = new Date();

    const result = await db.$transaction(async (tx) => {
      const doc = await tx.ingredientReturn.findUnique({
        where: { id },
        select: {
          status: true,
          recordedById: true,
          lines: { select: { issue: { select: { orderId: true } } } },
        },
      });
      if (!doc) {
        throw new ActionError("That declaration no longer exists — refresh and try again.");
      }
      // The chef is in this gate only to withdraw their OWN declaration —
      // never to overrule the store on someone else's.
      if (
        session.user.role === Role.KITCHEN_HEAD &&
        doc.recordedById !== session.user.id
      ) {
        throw new ActionError("You can only withdraw a declaration you raised yourself.");
      }
      if (doc.status !== IngredientReturnStatus.DECLARED) {
        throw new ActionError(
          doc.status === IngredientReturnStatus.CONFIRMED
            ? "This return is already confirmed — the stock is back on hand and can't be undone here."
            : "This declaration has already been turned down.",
        );
      }

      const flipped = await tx.ingredientReturn.updateMany({
        where: { id, status: IngredientReturnStatus.DECLARED },
        data: {
          status: IngredientReturnStatus.REJECTED,
          rejectedById: session.user.id,
          rejectedAt,
          rejectionReason: trimmed,
        },
      });
      if (flipped.count === 0) {
        throw new ActionError("This declaration just changed — refresh the page.");
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "INGREDIENT_RETURN_DECLARATION_REJECTED",
          entity: "IngredientReturn",
          entityId: id,
          payloadHash: sha256Json({ reason: trimmed }),
        },
      });
      return {
        orderIds: [
          ...new Set(doc.lines.map((l) => l.issue.orderId).filter((o): o is string => o != null)),
        ],
      };
    });

    revalidatePath("/inventory/returns");
    revalidatePath("/dashboard");
    for (const orderId of result.orderIds) revalidatePath(`/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Issues with something still open against them, for the two return
 * pickers. `returnable` is the hard ceiling (issued − CONFIRMED returns);
 * `declarable` takes off what is already declared and waiting on the store,
 * so the chef can't queue a second promise for the same stock.
 */
async function openIssueRows(opts: { orderId?: string; limit?: number }) {
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
      returnLines: { select: { quantity: true, return: { select: { status: true } } } },
    },
  });
  return issues.map((i) => {
    const sumWhere = (status: IngredientReturnStatus) =>
      i.returnLines
        .filter((l) => l.return.status === status)
        .reduce((s, l) => s.plus(toDecimal(l.quantity)), new Decimal(0));
    const returned = sumWhere(IngredientReturnStatus.CONFIRMED);
    const declared = sumWhere(IngredientReturnStatus.DECLARED);
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
      pendingDeclared: declared.toString(),
      declarable: remainingReturnable(i.qty.toString(), returned.plus(declared)).toString(),
    };
  });
}

/**
 * Issues that still have something returnable, for the store's direct
 * return screen. Capped at CONFIRMED returns only — a pending declaration
 * has moved nothing, so it must not stop the store booking in stock that
 * physically arrived at the counter.
 */
export async function listReturnableIssues(opts: { orderId?: string; limit?: number } = {}) {
  await requireRole(WRITE_ROLES);
  const rows = await openIssueRows(opts);
  return rows.filter((i) => toDecimal(i.returnable).gt(0));
}

/** The same list for the chef's declaration screen, capped at what isn't
 *  already promised to the store. */
export async function listDeclarableIssues(opts: { orderId?: string; limit?: number } = {}) {
  await requireRole(DECLARE_ROLES);
  const rows = await openIssueRows(opts);
  return rows.filter((i) => toDecimal(i.declarable).gt(0));
}

/** Columns every return screen needs, so the list, the confirm page and the
 *  order panel all read the same row shape. */
const RETURN_SELECT = {
  id: true,
  status: true,
  returnedAt: true,
  notes: true,
  confirmedAt: true,
  confirmationNote: true,
  rejectedAt: true,
  rejectionReason: true,
  rejectedById: true,
  recordedById: true,
  recordedBy: { select: { name: true } },
  confirmedBy: { select: { name: true } },
  rejectedBy: { select: { name: true } },
  createdAt: true,
  lines: {
    select: {
      id: true,
      quantity: true,
      declaredQuantity: true,
      unitCost: true,
      reason: true,
      issue: {
        select: {
          id: true,
          qty: true,
          ingredient: { select: { name: true, unit: true } },
          order: { select: { id: true, code: true } },
        },
      },
    },
  },
} satisfies Prisma.IngredientReturnSelect;

export type IngredientReturnRow = Prisma.IngredientReturnGetPayload<{
  select: typeof RETURN_SELECT;
}>;

export async function listRecentReturns(opts: { limit?: number } = {}) {
  await requireRole(READ_ROLES);
  return db.ingredientReturn.findMany({
    orderBy: { returnedAt: "desc" },
    take: opts.limit ?? 50,
    select: RETURN_SELECT,
  });
}

/** One return / declaration, for the store's confirm screen. */
export async function getIngredientReturn(id: string): Promise<IngredientReturnRow | null> {
  await requireRole(READ_ROLES);
  return db.ingredientReturn.findUnique({ where: { id }, select: RETURN_SELECT });
}

/**
 * Declarations waiting on the store — their queue, and the chef's "still
 * waiting" list. `mine` scopes it to the caller's own declarations.
 */
export async function listPendingReturnDeclarations(opts: { mine?: boolean } = {}) {
  const session = await requireRole(READ_ROLES);
  return db.ingredientReturn.findMany({
    where: {
      status: IngredientReturnStatus.DECLARED,
      ...(opts.mine ? { recordedById: session.user.id } : {}),
    },
    orderBy: { returnedAt: "asc" },
    select: RETURN_SELECT,
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
