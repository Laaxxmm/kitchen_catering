"use server";

import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { toDecimal } from "@/lib/money";

const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER, Role.MAINTENANCE_MANAGER, Role.FNB_SERVICE,
];

export type StoreKey = "housekeeping" | "maintenance" | "banquet";

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
