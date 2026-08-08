"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { sha256Json } from "@/lib/audit";
import { actionFailure, type ActionResultWith } from "@/server/action-result";

// Removes the bootstrap seed's sample catalogue from a live system.
//
// The container re-ran prisma/seed.ts on every deploy while SEED_DB was
// true, so after the client erased and imported their own catalogue the
// 136 demo STR-nnnn ingredients (and the demo F&B packaging list) came
// straight back beside the real ones. The seed can no longer do that, but
// the rows it already planted have to come out — and by then real orders
// had been taken, so "erase everything and import again" is off the table.
//
// A sample row is one the import did not create: every imported item
// carries a GP- code. Anything else in the catalogue is either seed data or
// pre-import legacy, and neither belongs in the pickers.
//
// Rows nothing points at are deleted. Rows something DOES point at — a
// receipt, an issue, a recipe line, a PO line — are deactivated instead, so
// the documents that reference them keep reading correctly and only the
// pickers get clean. Nothing that names a real order is ever removed.

/** What each catalogue's cleanup did. */
export interface CleanupSide {
  deleted: number;
  deactivated: number;
  /** The in-use ones, so the admin can see what stayed and why. */
  keptNames: string[];
}

export interface SampleCleanupSummary {
  kitchen: CleanupSide;
  fnb: CleanupSide;
  /** True when nothing was written — the preview pass. */
  preview: boolean;
}

const INGREDIENT_REFS = {
  receipts: true,
  issues: true,
  adjustments: true,
  recipeIngredients: true,
  prLines: true,
  orderBudgetLines: true,
  vendorPOLines: true,
  chefRequisitionLines: true,
} as const;

const BANQUET_REFS = {
  receiptLines: true,
  issueLines: true,
  returnLines: true,
  requisitionLines: true,
  vendorPOLines: true,
} as const;

function total(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/**
 * @param preview when true, counts what would happen and writes nothing.
 */
export async function removeSampleCatalogueItems(
  preview = false,
): Promise<ActionResultWith<SampleCleanupSummary>> {
  try {
    const session = await requireRole([Role.ADMIN, Role.MANAGER]);

    const [ingredients, banquetItems] = await Promise.all([
      db.ingredient.findMany({
        where: { NOT: { sku: { startsWith: "GP-" } } },
        select: { id: true, name: true, sku: true, _count: { select: INGREDIENT_REFS } },
      }),
      db.banquetItem.findMany({
        // sku is nullable on BanquetItem, and a seeded row has none.
        where: { OR: [{ sku: null }, { NOT: { sku: { startsWith: "GP-" } } }] },
        select: { id: true, name: true, sku: true, _count: { select: BANQUET_REFS } },
      }),
    ]);

    const split = <T extends { id: string; name: string; _count: Record<string, number> }>(
      rows: T[],
    ) => ({
      removable: rows.filter((r) => total(r._count) === 0),
      inUse: rows.filter((r) => total(r._count) > 0),
    });

    const kitchen = split(ingredients);
    const fnb = split(banquetItems);

    const summary: SampleCleanupSummary = {
      kitchen: {
        deleted: kitchen.removable.length,
        deactivated: kitchen.inUse.length,
        keptNames: kitchen.inUse.map((r) => r.name),
      },
      fnb: {
        deleted: fnb.removable.length,
        deactivated: fnb.inUse.length,
        keptNames: fnb.inUse.map((r) => r.name),
      },
      preview,
    };

    if (preview) return { ok: true, ...summary };

    // One transaction: a half-cleaned catalogue is harder to reason about
    // than an uncleaned one, and the admin would have no way to tell which
    // half ran.
    await db.$transaction(async (tx) => {
      if (kitchen.removable.length > 0) {
        await tx.ingredient.deleteMany({
          where: { id: { in: kitchen.removable.map((r) => r.id) } },
        });
      }
      if (kitchen.inUse.length > 0) {
        await tx.ingredient.updateMany({
          where: { id: { in: kitchen.inUse.map((r) => r.id) } },
          data: { active: false },
        });
      }
      if (fnb.removable.length > 0) {
        await tx.banquetItem.deleteMany({
          where: { id: { in: fnb.removable.map((r) => r.id) } },
        });
      }
      if (fnb.inUse.length > 0) {
        await tx.banquetItem.updateMany({
          where: { id: { in: fnb.inUse.map((r) => r.id) } },
          data: { active: false },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "SAMPLE_CATALOGUE_REMOVED",
          entity: "System",
          entityId: "sample-catalogue-cleanup",
          payloadHash: sha256Json(summary),
        },
      });
    });

    revalidatePath("/inventory/ingredients");
    revalidatePath("/banquet/items");
    revalidatePath("/admin/settings");

    return { ok: true, ...summary };
  } catch (err) {
    return actionFailure(err);
  }
}
