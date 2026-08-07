import { db } from "@/server/db";

/**
 * The catalogue rows the F&B scenarios trade in, by their GP code. Looked up
 * rather than hardcoded by id: the import is what creates them, and a missing
 * code should read as "the catalogue import didn't run", not as a null id
 * failing forty lines later.
 */
export const FNB_CODES = {
  /** Ripple Cups [210 ml] — 5,250 pcs opening, the line the store issues in full. */
  plentiful: "GP-IN-002",
  /** Soup Bowl, in-house Crockery — 15 pcs opening, so a 40 pc ask goes part-issued. */
  shallow: "GP-IN-070",
  /** soup bowl, hired Melamine @ ₹2.50 — no stock, straight to procurement. */
  hiredMelamine: "GP-HR-004",
  /** soup bowl, hired Bonechina @ ₹3.50 — the same name at a different rate. */
  hiredBonechina: "GP-HR-008",
} as const;

export interface FnbItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  currentStock: string;
}

export async function fnbItem(sku: string): Promise<FnbItem> {
  const row = await db.banquetItem.findFirst({
    where: { sku },
    select: { id: true, sku: true, name: true, unit: true, currentStock: true },
  });
  if (!row) {
    throw new Error(`Catalogue import left no F&B item ${sku} — did the import run?`);
  }
  return { ...row, sku: row.sku!, currentStock: row.currentStock.toString() };
}

/** On-hand for one F&B item, read back out of the database. */
export async function fnbStock(itemId: string): Promise<string> {
  const row = await db.banquetItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { currentStock: true },
  });
  return row.currentStock.toString();
}

/** One requisition line, found by the item it asks for. */
export async function reqLine(requisitionId: string, itemId: string) {
  return db.banquetRequisitionLine.findFirstOrThrow({ where: { requisitionId, itemId } });
}
