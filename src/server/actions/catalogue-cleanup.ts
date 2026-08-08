"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { sha256Json } from "@/lib/audit";
import { unitsEquivalent } from "@/lib/units";
import { actionFailure, type ActionResultWith } from "@/server/action-result";
import { mergeIngredient } from "@/server/actions/inventory";

// Folds the bootstrap seed's sample catalogue back into the client's own.
//
// The container re-ran prisma/seed.ts on every deploy while SEED_DB was
// true, so after the client erased and imported their own catalogue the 136
// demo STR-nnnn ingredients came back beside the real ones. The seed can no
// longer do that (see prisma/seed.ts), but by the time it was caught the
// team had been receiving stock — and they had been picking the STR- twin,
// because it was the one showing a figure. So the GP- items read zero while
// the real stock sat on rows that should not exist.
//
// That rules out deleting them: the stock and every receipt, issue and PO
// line behind it would go too. Each sample row is instead MERGED into its
// GP- twin by name, which is what mergeIngredient already does — fold the
// stock in at weighted average, re-point all eight reference tables, retire
// the source. Only rows with no twin fall through to delete (nothing points
// at them) or deactivate (something does).
//
// A sample row is one the import did not create: every imported item carries
// a GP- code.

/** One sample row and what the cleanup will do with it. */
export interface CleanupPlanRow {
  id: string;
  name: string;
  sku: string | null;
  qty: string;
  /** Set when a GP- twin was found by name. */
  intoSku?: string;
  /** Why it is not being merged, when it isn't. */
  reason?: string;
}

export interface CleanupPlan {
  /** Has a GP- twin in the same unit — stock and history move across. */
  merge: CleanupPlanRow[];
  /** No twin, nothing references it — safe to delete outright. */
  remove: CleanupPlanRow[];
  /** No twin but referenced by a document — hidden, never deleted. */
  hide: CleanupPlanRow[];
  /** Twin found but the units disagree; merging would corrupt the figures. */
  blocked: CleanupPlanRow[];
}

export interface SampleCleanupSummary {
  kitchen: CleanupPlan;
  fnb: CleanupPlan;
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

function refCount(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** The seed and the spreadsheets disagree on case and stray spaces, and that
 *  is exactly the pair we need to recognise as one item. */
function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const emptyPlan = (): CleanupPlan => ({ merge: [], remove: [], hide: [], blocked: [] });

/**
 * @param preview when true, works out the plan and writes nothing.
 */
export async function removeSampleCatalogueItems(
  preview = false,
): Promise<ActionResultWith<SampleCleanupSummary>> {
  try {
    const session = await requireRole([Role.ADMIN, Role.MANAGER]);

    // ── Kitchen ────────────────────────────────────────────────────────
    const [samples, keepers] = await Promise.all([
      db.ingredient.findMany({
        // Active only. A merged source is retired, not deleted — that is
        // mergeIngredient keeping the audit trail — and a second run must
        // not come back and delete the row it just retired.
        where: { active: true, NOT: { sku: { startsWith: "GP-" } } },
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          onHandQty: true,
          _count: { select: INGREDIENT_REFS },
        },
      }),
      db.ingredient.findMany({
        where: { active: true, sku: { startsWith: "GP-" } },
        select: { id: true, name: true, sku: true, unit: true },
      }),
    ]);
    const twinByName = new Map(keepers.map((k) => [nameKey(k.name), k]));

    const kitchen = emptyPlan();
    // id → target id, built alongside the plan so the write pass does not
    // have to re-derive any of this.
    const merges: Array<[string, string]> = [];
    for (const s of samples) {
      const row: CleanupPlanRow = {
        id: s.id,
        name: s.name,
        sku: s.sku,
        qty: s.onHandQty.toString(),
      };
      const twin = twinByName.get(nameKey(s.name));
      if (twin) {
        if (unitsEquivalent(s.unit, twin.unit)) {
          kitchen.merge.push({ ...row, intoSku: twin.sku });
          merges.push([s.id, twin.id]);
        } else {
          // mergeIngredient refuses this too — 5 pkt folded into kg becomes
          // 5 kg. Surface it so somebody aligns the units by hand.
          kitchen.blocked.push({
            ...row,
            intoSku: twin.sku,
            reason: `tracked in ${s.unit}, the GP item in ${twin.unit}`,
          });
        }
      } else if (refCount(s._count) === 0) {
        kitchen.remove.push(row);
      } else {
        kitchen.hide.push({ ...row, reason: "referenced by a document" });
      }
    }

    // ── F&B ────────────────────────────────────────────────────────────
    // No merge exists for BanquetItem and none is invented here: the demo
    // packaging list was never a duplicate of the client's own items, so
    // there is nothing to fold. Delete what is unused, hide what is not.
    const fnbSamples = await db.banquetItem.findMany({
      // sku is nullable on BanquetItem, and a seeded row has none.
      where: {
        active: true,
        OR: [{ sku: null }, { NOT: { sku: { startsWith: "GP-" } } }],
      },
      select: {
        id: true,
        name: true,
        sku: true,
        currentStock: true,
        _count: { select: BANQUET_REFS },
      },
    });
    const fnb = emptyPlan();
    for (const s of fnbSamples) {
      const row: CleanupPlanRow = {
        id: s.id,
        name: s.name,
        sku: s.sku,
        qty: s.currentStock.toString(),
      };
      if (refCount(s._count) === 0) fnb.remove.push(row);
      else fnb.hide.push({ ...row, reason: "referenced by a document" });
    }

    const summary: SampleCleanupSummary = { kitchen, fnb, preview };
    if (preview) return { ok: true, ...summary };

    // Each merge is its own transaction inside mergeIngredient, which takes
    // row locks and folds the stock at weighted average. Run them one at a
    // time and stop at the first refusal rather than pressing on: a partly
    // merged catalogue is still readable, and the message says which item
    // needs a human.
    for (const [sourceId, targetId] of merges) {
      const res = await mergeIngredient(sourceId, targetId);
      if (!res.ok) {
        const failed = kitchen.merge.find((m) => m.id === sourceId);
        return actionFailure(
          new Error(
            `Merged what came before it, then stopped at ${failed?.sku ?? sourceId} ` +
              `(${failed?.name ?? "unknown"}): ${res.error}`,
          ),
        );
      }
    }

    await db.$transaction(async (tx) => {
      if (kitchen.remove.length > 0) {
        await tx.ingredient.deleteMany({
          where: { id: { in: kitchen.remove.map((r) => r.id) } },
        });
      }
      if (kitchen.hide.length > 0) {
        await tx.ingredient.updateMany({
          where: { id: { in: kitchen.hide.map((r) => r.id) } },
          data: { active: false },
        });
      }
      if (fnb.remove.length > 0) {
        await tx.banquetItem.deleteMany({ where: { id: { in: fnb.remove.map((r) => r.id) } } });
      }
      if (fnb.hide.length > 0) {
        await tx.banquetItem.updateMany({
          where: { id: { in: fnb.hide.map((r) => r.id) } },
          data: { active: false },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "SAMPLE_CATALOGUE_CLEANED",
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
