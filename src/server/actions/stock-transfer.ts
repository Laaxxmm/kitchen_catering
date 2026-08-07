"use server";

import { revalidatePath } from "next/cache";
import { Prisma, Role, StockStore } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { StockTransferInput } from "@/lib/validators";
import { newMovingAverage } from "@/lib/inventory-cost";
import { STORE_LABELS, checkTransferQty } from "@/lib/stock-movement";
import { unitsEquivalent } from "@/lib/units";
import { istToUtc } from "@/lib/time";
import { toDecimal } from "@/lib/money";
import { sha256Json } from "@/lib/audit";
import {
  ActionError,
  actionFailure,
  type ActionResultWith,
} from "@/server/action-result";

// Stock moving between the three stores. The hard part is that they hold
// DIFFERENT item records: foil in the kitchen is an Ingredient row, foil in
// F&B is a BanquetItem row. So a transfer is never one row's quantity
// moving — it decrements a row in store A and increments a different row in
// store B, in one transaction, and the user names both rows explicitly.
// Nothing here matches items by name: "Aluminium Foil" and "Aluminium Foil
// [Roll]" are different rows, often in different units, and a silent wrong
// match corrupts two stores at once.
//
// Mirrors inventory.ts's WRITE_ROLES (a "use server" file can only export
// async functions, so the list can't be shared across the two).
const TRANSFER_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];

/** One side of a transfer, read uniformly across the three catalogues. */
interface Side {
  id: string;
  name: string;
  unit: string;
  active: boolean;
  qty: Decimal;
  /** Only the kitchen carries a valuation; F&B and housekeeping are quantity-only. */
  cost: Decimal | null;
  /** The exact values read, for the guarded write's where-clause. */
  rawQty: Prisma.Decimal;
  rawCost: Prisma.Decimal | null;
}

/**
 * Row-lock one item. Callers lock BOTH sides, in a stable key order, before
 * reading either — same discipline as the kitchen issue path, and the sort
 * is what stops two opposite transfers (A→B and B→A) deadlocking.
 */
async function lockRow(tx: Prisma.TransactionClient, store: StockStore, id: string) {
  switch (store) {
    case StockStore.KITCHEN:
      await tx.$executeRaw`SELECT 1 FROM "Ingredient" WHERE "id" = ${id} FOR UPDATE`;
      return;
    case StockStore.FNB:
      await tx.$executeRaw`SELECT 1 FROM "BanquetItem" WHERE "id" = ${id} FOR UPDATE`;
      return;
    case StockStore.HOUSEKEEPING:
      await tx.$executeRaw`SELECT 1 FROM "HousekeepingItem" WHERE "id" = ${id} FOR UPDATE`;
      return;
  }
}

async function readSide(
  tx: Prisma.TransactionClient,
  store: StockStore,
  id: string,
): Promise<Side | null> {
  if (store === StockStore.KITCHEN) {
    const r = await tx.ingredient.findUnique({
      where: { id },
      select: { id: true, name: true, unit: true, active: true, onHandQty: true, avgUnitCost: true },
    });
    return r
      ? {
          id: r.id, name: r.name, unit: r.unit, active: r.active,
          qty: toDecimal(r.onHandQty), cost: toDecimal(r.avgUnitCost),
          rawQty: r.onHandQty, rawCost: r.avgUnitCost,
        }
      : null;
  }
  const r =
    store === StockStore.FNB
      ? await tx.banquetItem.findUnique({
          where: { id },
          select: { id: true, name: true, unit: true, active: true, currentStock: true },
        })
      : await tx.housekeepingItem.findUnique({
          where: { id },
          select: { id: true, name: true, unit: true, active: true, currentStock: true },
        });
  return r
    ? {
        id: r.id, name: r.name, unit: r.unit, active: r.active,
        qty: toDecimal(r.currentStock), cost: null,
        rawQty: r.currentStock, rawCost: null,
      }
    : null;
}

/**
 * Guarded write: the where-clause pins the exact quantity (and, in the
 * kitchen, cost) this transfer computed against, so a concurrent movement
 * can never be silently overwritten. Returns the row count for the caller
 * to check.
 */
async function writeSide(
  tx: Prisma.TransactionClient,
  store: StockStore,
  side: Side,
  next: { qty: Decimal; cost: Decimal | null },
): Promise<number> {
  const qty = next.qty.toDecimalPlaces(3).toString();
  switch (store) {
    case StockStore.KITCHEN: {
      const res = await tx.ingredient.updateMany({
        where: { id: side.id, onHandQty: side.rawQty, avgUnitCost: side.rawCost! },
        data: {
          onHandQty: qty,
          ...(next.cost ? { avgUnitCost: next.cost.toDecimalPlaces(4).toString() } : {}),
        },
      });
      return res.count;
    }
    case StockStore.FNB: {
      const res = await tx.banquetItem.updateMany({
        where: { id: side.id, currentStock: side.rawQty },
        data: { currentStock: qty },
      });
      return res.count;
    }
    case StockStore.HOUSEKEEPING: {
      const res = await tx.housekeepingItem.updateMany({
        where: { id: side.id, currentStock: side.rawQty },
        data: { currentStock: qty },
      });
      return res.count;
    }
  }
}

export async function recordStockTransfer(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordStockTransferInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordStockTransferInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(TRANSFER_ROLES);
  const input = StockTransferInput.parse(raw);

  if (input.fromStore === input.toStore) {
    throw new ActionError(
      `Both sides are the ${STORE_LABELS[input.fromStore]} — moving stock inside one store is a stock adjustment, not a transfer.`,
    );
  }

  const transfer = await db.$transaction(async (tx) => {
    // Lock both rows before reading either, in a stable key order.
    const sides = [
      { store: input.fromStore, id: input.fromItemId },
      { store: input.toStore, id: input.toItemId },
    ].sort((a, b) => `${a.store}:${a.id}`.localeCompare(`${b.store}:${b.id}`));
    for (const s of sides) await lockRow(tx, s.store, s.id);

    const [from, to] = await Promise.all([
      readSide(tx, input.fromStore, input.fromItemId),
      readSide(tx, input.toStore, input.toItemId),
    ]);
    if (!from) throw new ActionError("The source item no longer exists — refresh and try again.");
    if (!to) throw new ActionError("The destination item no longer exists — refresh and try again.");
    if (!to.active) throw new ActionError(`${to.name} is inactive in the destination store.`);

    const qty = toDecimal(input.quantity || "0");
    const refusal = checkTransferQty({
      want: qty, onHand: from.qty, name: from.name, unit: from.unit,
    });
    if (refusal) throw new ActionError(refusal);

    // Units are never converted. Same measure (allowing for spelling) moves
    // straight through; genuinely different ones need the user to say out
    // loud that they meant it, because a 1:1 move between kg and pcs quietly
    // destroys both ledgers.
    if (!unitsEquivalent(from.unit, to.unit) && !input.unitsAcknowledged) {
      throw new ActionError(
        `${from.name} is tracked in ${from.unit} and ${to.name} in ${to.unit}. Nothing is converted — ${qty.toString()} would move across as ${qty.toString()} ${to.unit}. Tick the units confirmation if that is what you mean.`,
      );
    }

    // Cost carried across. The kitchen's average is the source of truth when
    // it is the source; when the source keeps no valuation the destination's
    // own average is used, which leaves that average untouched rather than
    // inventing a price.
    // ponytail: F&B and housekeeping hold no cost at all, so a transfer INTO
    // the kitchen from them adds quantity at the kitchen's existing average.
    // Put a cost field on the form if those stores ever start being valued.
    const unitCost = from.cost ?? (to.cost ?? null);

    const fromNext = from.qty.minus(qty);
    const dec = await writeSide(tx, input.fromStore, from, { qty: fromNext, cost: from.cost });
    if (dec === 0) {
      throw new ActionError("That stock just changed — refresh and try again.");
    }

    // The destination takes it in like a receipt: quantity up, and in the
    // kitchen the average re-weighted at the cost that came across.
    let toNext: { qty: Decimal; cost: Decimal | null };
    if (to.cost !== null) {
      const m = newMovingAverage({
        onHandQty: to.qty,
        avgUnitCost: to.cost,
        receiptQty: qty,
        receiptUnitCost: unitCost ?? to.cost,
      });
      toNext = { qty: m.qty, cost: m.avgUnitCost };
    } else {
      toNext = { qty: to.qty.plus(qty), cost: null };
    }
    const inc = await writeSide(tx, input.toStore, to, toNext);
    if (inc === 0) {
      throw new ActionError("That stock just changed — refresh and try again.");
    }

    const created = await tx.stockTransfer.create({
      data: {
        transferredAt: istToUtc(input.transferredAt),
        recordedById: session.user.id,
        fromStore: input.fromStore,
        toStore: input.toStore,
        fromItemId: from.id,
        fromItemName: from.name,
        fromUnit: from.unit,
        toItemId: to.id,
        toItemName: to.name,
        toUnit: to.unit,
        quantity: qty.toDecimalPlaces(3).toString(),
        unitCost: unitCost ? unitCost.toDecimalPlaces(4).toString() : null,
        notes: input.notes?.trim() || null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "STOCK_TRANSFERRED",
        entity: "StockTransfer",
        entityId: created.id,
        payloadHash: sha256Json({
          from: `${input.fromStore}:${from.id}`,
          to: `${input.toStore}:${to.id}`,
          qty: qty.toString(),
          fromUnit: from.unit,
          toUnit: to.unit,
        }),
      },
    });
    return created;
  });

  revalidatePath("/inventory/transfers");
  revalidatePath("/inventory/ingredients");
  revalidatePath("/banquet/items");
  revalidatePath("/housekeeping/items");
  return { ok: true, id: transfer.id };
}

export interface TransferItemOption {
  id: string;
  store: StockStore;
  /**
   * GP code, F&B only. The other two catalogues have unique names; the F&B
   * one does not (in-house vs hired soup bowls), and the code prefix
   * GP-IN- / GP-HR- is what tells the two apart in the dropdown.
   */
  sku: string | null;
  name: string;
  unit: string;
  stock: string;
}

/**
 * Every store's active catalogue, for the two dropdowns. The pickers are
 * dropdown-only: the store may not free-type or create items here, and
 * catalogue creation stays with admin/manager in each store's own screen.
 */
export async function listTransferItems(): Promise<TransferItemOption[]> {
  await requireRole(TRANSFER_ROLES);
  const [ingredients, banquet, housekeeping] = await Promise.all([
    db.ingredient.findMany({
      where: { active: true },
      select: { id: true, name: true, unit: true, onHandQty: true },
      orderBy: { name: "asc" },
    }),
    db.banquetItem.findMany({
      where: { active: true },
      select: { id: true, sku: true, name: true, unit: true, currentStock: true, category: true },
      orderBy: { name: "asc" },
    }),
    db.housekeepingItem.findMany({
      where: { active: true },
      select: { id: true, name: true, unit: true, currentStock: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return [
    ...ingredients.map((i) => ({
      id: i.id, store: StockStore.KITCHEN, sku: null, name: i.name, unit: i.unit, stock: i.onHandQty.toString(),
    })),
    ...banquet.map((i) => ({
      id: i.id,
      store: StockStore.FNB,
      sku: i.sku,
      // Grade appended to the name so Melamine and Bonechina rows of the same
      // item are not two identical options.
      name: i.category ? `${i.name} (${i.category})` : i.name,
      unit: i.unit,
      stock: i.currentStock.toString(),
    })),
    ...housekeeping.map((i) => ({
      id: i.id, store: StockStore.HOUSEKEEPING, sku: null, name: i.name, unit: i.unit, stock: i.currentStock.toString(),
    })),
  ];
}

export async function listRecentTransfers(opts: { limit?: number } = {}) {
  await requireRole(TRANSFER_ROLES);
  return db.stockTransfer.findMany({
    orderBy: { transferredAt: "desc" },
    take: opts.limit ?? 100,
    include: { recordedBy: { select: { name: true } } },
  });
}
