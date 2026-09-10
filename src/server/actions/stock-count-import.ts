"use server";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { requireRole } from "@/server/rbac";
import { actionFailure, type ActionResultWith } from "@/server/action-result";
import {
  applyStockCountPlan,
  planStockCount,
  type StockCountFile,
  type StockCountPlan,
  type StockCountResult,
} from "@/server/stock-count-core";

// Physical stock counts, reconciled from the store's spreadsheet into
// data/stock-counts/<date>.json, applied from Admin → Settings. ADMIN only —
// it sets on-hand and cost for the whole catalogue in one go. Production has
// no shell, which is why this is a button and not a script.

const COUNT_DIR = path.join(process.cwd(), "data", "stock-counts");
const COUNT_ID = /^\d{4}-\d{2}-\d{2}$/;

function loadCount(id: string): StockCountFile {
  // The id is a file name. The pattern check is what keeps it one.
  if (!COUNT_ID.test(id)) throw new Error("Not a stock count id");
  return JSON.parse(readFileSync(path.join(COUNT_DIR, `${id}.json`), "utf8")) as StockCountFile;
}

/** The counts shipped with this build, newest first. */
export async function listStockCounts(): Promise<Array<{ id: string; source: string; rows: number }>> {
  await requireRole([Role.ADMIN]);
  let files: string[] = [];
  try {
    files = readdirSync(COUNT_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => f.replace(/\.json$/, ""))
    .filter((id) => COUNT_ID.test(id))
    .sort()
    .reverse()
    .map((id) => {
      const c = loadCount(id);
      return { id, source: c.source, rows: c.rows.length };
    });
}

export async function previewStockCount(id: string): Promise<ActionResultWith<{ plan: StockCountPlan }>> {
  try {
    await requireRole([Role.ADMIN]);
    return { ok: true, plan: await planStockCount(loadCount(id)) };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function applyStockCount(id: string): Promise<ActionResultWith<StockCountResult>> {
  try {
    const session = await requireRole([Role.ADMIN]);
    const result = await applyStockCountPlan(loadCount(id), session.user.id);
    revalidatePath("/inventory/ingredients");
    revalidatePath("/admin/settings");
    return { ok: true, ...result };
  } catch (err) {
    return actionFailure(err);
  }
}
