"use server";

import { revalidatePath } from "next/cache";
import { Role, type Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { getSettingOr } from "@/lib/settings";
import { toDecimal } from "@/lib/money";
import { sha256Json } from "@/lib/audit";
import {
  ActionError,
  actionFailure,
  type ActionResult,
} from "@/server/action-result";

const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER, Role.MAINTENANCE_MANAGER,
  // F&B Service (role DELIVERY, FNB_SERVICE its retired alias) runs the banquet store.
  Role.FNB_SERVICE, Role.DELIVERY,
  // Store keeper: loads/corrects F&B stock (writes gated per store below +
  // the stock.storeDirectEdit toggle for banquet).
  Role.STORE_KEEPER,
];
// Who may correct on-hand for a given store: admin/manager + the store's
// own manager. Mirrors the receipt-write roles for each module.
const WRITE_ROLES_BY_STORE: Record<StoreKey, Role[]> = {
  housekeeping: [Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER],
  maintenance: [Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER],
  banquet: [Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY],
};

export type StoreKey = "housekeeping" | "maintenance" | "banquet";

/**
 * Row-lock a store item for the rest of the transaction. adjustStoreStock
 * reads currentStock, computes, then writes back — without the lock a
 * concurrent movement (receipt / issue / another adjustment) reads the same
 * snapshot and one update is silently lost. FOR UPDATE serialises them.
 */
async function lockStoreItemRow(tx: Prisma.TransactionClient, store: StoreKey, id: string) {
  if (store === "housekeeping") {
    await tx.$executeRaw`SELECT 1 FROM "HousekeepingItem" WHERE "id" = ${id} FOR UPDATE`;
  } else if (store === "maintenance") {
    await tx.$executeRaw`SELECT 1 FROM "MaintenanceItem" WHERE "id" = ${id} FOR UPDATE`;
  } else {
    await tx.$executeRaw`SELECT 1 FROM "BanquetItem" WHERE "id" = ${id} FOR UPDATE`;
  }
}

interface RawItem {
  id: string;
  name: string;
  unit: string;
  category?: string | null;
  currentStock: { toString(): string };
  minStock: { toString(): string } | null;
}

/**
 * Unified Out / Low / In-stock breakdown for the non-kitchen stores
 * (housekeeping, maintenance, banquet). Status uses the item's minStock
 * threshold, mirroring Kitchen stock's reorderLevel:
 *   currentStock <= 0           → Out
 *   minStock set & at/below it   → Low
 *   otherwise                    → In stock
 * Items with no minStock are flagged so the page can nudge the user to set
 * thresholds. Also returns this-week received / issued counts.
 */
export async function getStoreStock(store: StoreKey) {
  await requireRole(READ_ROLES);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  let items: RawItem[];
  let received: number;
  let issued: number;

  if (store === "housekeeping") {
    [items, received, issued] = await Promise.all([
      db.housekeepingItem.findMany({ where: { active: true }, select: { id: true, name: true, unit: true, currentStock: true, minStock: true } }),
      db.housekeepingReceipt.count({ where: { receivedAt: { gte: weekAgo } } }),
      db.housekeepingIssue.count({ where: { issuedAt: { gte: weekAgo } } }),
    ]);
  } else if (store === "maintenance") {
    [items, received, issued] = await Promise.all([
      db.maintenanceItem.findMany({ where: { active: true }, select: { id: true, name: true, unit: true, category: true, currentStock: true, minStock: true } }),
      db.maintenanceReceipt.count({ where: { receivedAt: { gte: weekAgo } } }),
      db.maintenanceActivity.count({ where: { performedAt: { gte: weekAgo } } }),
    ]);
  } else {
    [items, received, issued] = await Promise.all([
      db.banquetItem.findMany({ where: { active: true }, select: { id: true, name: true, unit: true, category: true, currentStock: true, minStock: true } }),
      db.banquetReceipt.count({ where: { receivedAt: { gte: weekAgo } } }),
      db.banquetIssue.count({ where: { issuedAt: { gte: weekAgo } } }),
    ]);
  }

  let out = 0, low = 0, inStock = 0, noThreshold = 0;
  const needsReorder: Array<{ id: string; name: string; unit: string; currentStock: string; minStock: string | null; out: boolean }> = [];

  for (const i of items) {
    const cur = toDecimal(i.currentStock.toString());
    const min = i.minStock != null ? toDecimal(i.minStock.toString()) : null;
    if (min === null) noThreshold += 1;
    const isOut = cur.lte(0);
    const isLow = !isOut && min !== null && cur.lte(min);
    if (isOut) out += 1;
    else if (isLow) low += 1;
    else inStock += 1;
    if (isOut || isLow) {
      needsReorder.push({
        id: i.id,
        name: i.name,
        unit: i.unit,
        currentStock: cur.toString(),
        minStock: min ? min.toString() : null,
        out: isOut,
      });
    }
  }
  needsReorder.sort((a, b) => (a.out === b.out ? a.name.localeCompare(b.name) : a.out ? -1 : 1));

  return { out, low, inStock, noThreshold, needsReorder, received, issued, itemCount: items.length };
}

/** Active items for a store's adjust-stock picker (id · name · unit · on-hand). */
export async function listStoreItems(store: StoreKey) {
  await requireRole(WRITE_ROLES_BY_STORE[store]);
  const select = { id: true, name: true, unit: true, currentStock: true } as const;
  const rows =
    store === "housekeeping"
      ? await db.housekeepingItem.findMany({ where: { active: true }, select, orderBy: { name: "asc" } })
      : store === "maintenance"
        ? await db.maintenanceItem.findMany({ where: { active: true }, select, orderBy: { name: "asc" } })
        : await db.banquetItem.findMany({ where: { active: true }, select, orderBy: { name: "asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, currentStock: toDecimal(r.currentStock).toString() }));
}

/**
 * Correct a store item's on-hand quantity — opening balance, physical-count
 * fix, or damage/write-off. Two modes:
 *   mode "set"   → currentStock becomes qty
 *   mode "delta" → currentStock += qty (qty may be negative)
 * The change + reason is recorded in the audit log (these stores have no
 * dedicated adjustment ledger; receipts/issues remain the movement history).
 * For *incoming purchased* stock use the store's "Record receipt" instead.
 */
export async function adjustStoreStock(input: {
  store: StoreKey;
  itemId: string;
  mode: "set" | "delta";
  qty: string;
  reason: string;
  note?: string;
}): Promise<ActionResult> {
  try {
    return await adjustStoreStockInner(input);
  } catch (err) {
    return actionFailure(err);
  }
}

async function adjustStoreStockInner(input: {
  store: StoreKey;
  itemId: string;
  mode: "set" | "delta";
  qty: string;
  reason: string;
  note?: string;
}): Promise<{ ok: true }> {
  // Admin toggle: store keeper may set F&B (banquet) stock directly
  // during the stock-loading phase.
  const directEdit =
    input.store === "banquet" ? await getSettingOr<boolean>("stock.storeDirectEdit", false) : false;
  const session = await requireRole(
    directEdit
      ? [...WRITE_ROLES_BY_STORE[input.store], Role.STORE_KEEPER]
      : WRITE_ROLES_BY_STORE[input.store],
  );
  if (!input.reason?.trim()) throw new ActionError("A reason is required");
  const amount = toDecimal(input.qty || "0");

  await db.$transaction(async (tx) => {
    await lockStoreItemRow(tx, input.store, input.itemId);
    const find = { where: { id: input.itemId }, select: { currentStock: true, name: true } };
    const item =
      input.store === "housekeeping"
        ? await tx.housekeepingItem.findUnique(find)
        : input.store === "maintenance"
          ? await tx.maintenanceItem.findUnique(find)
          : await tx.banquetItem.findUnique(find);
    if (!item) throw new ActionError("Item not found");

    const before = toDecimal(item.currentStock);
    const after = input.mode === "set" ? amount : before.plus(amount);
    if (after.lt(0)) throw new ActionError("Adjusted on-hand cannot be negative");
    if (after.eq(before)) throw new ActionError("No change — the quantity matches current on-hand");
    const next = after.toDecimalPlaces(3).toString();

    if (input.store === "housekeeping") await tx.housekeepingItem.update({ where: { id: input.itemId }, data: { currentStock: next } });
    else if (input.store === "maintenance") await tx.maintenanceItem.update({ where: { id: input.itemId }, data: { currentStock: next } });
    else await tx.banquetItem.update({ where: { id: input.itemId }, data: { currentStock: next } });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "STORE_STOCK_ADJUSTED",
        entity: input.store === "housekeeping" ? "HousekeepingItem" : input.store === "maintenance" ? "MaintenanceItem" : "BanquetItem",
        entityId: input.itemId,
        payloadHash: sha256Json({
          store: input.store,
          before: before.toString(),
          after: after.toString(),
          delta: after.minus(before).toString(),
          reason: input.reason,
          note: input.note ?? null,
        }),
      },
    });
  });

  revalidatePath(`/${input.store}`);
  revalidatePath(`/${input.store}/items`);
  return { ok: true };
}
