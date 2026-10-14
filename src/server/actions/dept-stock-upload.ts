"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { Prisma, Role, StoreAdjustmentKind, StoreDepartment } from "@prisma/client";
import { db } from "@/server/db";
import { AuthorizationError, requireRole } from "@/server/rbac";
import { sha256Json } from "@/lib/audit";
import { deferAfterResponse } from "@/server/defer";
import { notifyRoles } from "@/server/notification-core";
import { ActionError, actionFailure, type ActionResultWith } from "@/server/action-result";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_ROLES,
  nameKey,
  parseDepartment,
  planUpload,
  readStockFile,
  type ExistingItem,
  type PlanRow,
  type UploadPlan,
  type UploadRow,
} from "@/server/dept-stock-upload";

// The one-time stock upload that opens a self-run department's own store:
// the head (or admin / manager) fills the template, previews what it will
// do, and applies it. Housekeeping and maintenance are separate products —
// a head can only ever upload into their own department.
//
// Apply never trusts the preview: it re-reads the same file, re-plans it
// under row locks and writes all of it or none of it. Re-applying the same
// file finds every row UNCHANGED and writes nothing.

type Tx = Prisma.TransactionClient;

const ANY_UPLOADER = [...new Set([...UPLOAD_ROLES.HOUSEKEEPING, ...UPLOAD_ROLES.MAINTENANCE])];

async function authorise(department: unknown) {
  const session = await requireRole(ANY_UPLOADER);
  const dept = parseDepartment(department);
  if (!UPLOAD_ROLES[dept].includes(session.user.role)) {
    throw new AuthorizationError(`Requires one of: ${UPLOAD_ROLES[dept].join(", ")}`);
  }
  return { session, dept };
}

async function readUpload(formData: unknown, dept: StoreDepartment): Promise<{ rows: UploadRow[]; fileHash: string }> {
  const file = formData instanceof FormData ? formData.get("file") : null;
  if (!file || typeof file === "string") throw new ActionError("Choose a file to upload.");
  // Checked before the bytes are read, and again on the bytes themselves.
  if (file.size > MAX_UPLOAD_BYTES) throw new ActionError("That file is larger than 1 MB — upload the stock sheet on its own.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    rows: await readStockFile({ name: file.name, bytes }, dept),
    fileHash: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** The department's items as the planner sees them. History of any kind pins the unit. */
async function loadExisting(tx: Tx, dept: StoreDepartment): Promise<ExistingItem[]> {
  if (dept === StoreDepartment.HOUSEKEEPING) {
    const rows = await tx.housekeepingItem.findMany({
      select: {
        id: true, name: true, unit: true, active: true, currentStock: true, inCirculation: true,
        minStock: true, reusable: true,
        _count: { select: { receiptLines: true, issueLines: true, adjustments: true, purchaseLines: true } },
      },
    });
    return rows.map(({ _count: n, ...r }) => ({
      ...r,
      currentStock: r.currentStock.toString(),
      inCirculation: r.inCirculation.toString(),
      minStock: r.minStock?.toString() ?? null,
      category: null,
      hasHistory: n.receiptLines + n.issueLines + n.adjustments + n.purchaseLines > 0,
    }));
  }
  const rows = await tx.maintenanceItem.findMany({
    select: {
      id: true, name: true, unit: true, active: true, currentStock: true, minStock: true, category: true,
      _count: { select: { receiptLines: true, activityLines: true, adjustments: true, purchaseLines: true } },
    },
  });
  return rows.map(({ _count: n, ...r }) => ({
    ...r,
    currentStock: r.currentStock.toString(),
    inCirculation: "0",
    minStock: r.minStock?.toString() ?? null,
    reusable: null,
    hasHistory: n.receiptLines + n.activityLines + n.adjustments + n.purchaseLines > 0,
  }));
}

/** What the file would do, row by row. Writes nothing. */
export async function previewDeptStockUpload(
  department: StoreDepartment,
  formData: FormData,
): Promise<ActionResultWith<UploadPlan>> {
  try {
    const { dept } = await authorise(department);
    const { rows } = await readUpload(formData, dept);
    return { ok: true, ...planUpload(rows, await loadExisting(db, dept)) };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function applyDeptStockUpload(
  department: StoreDepartment,
  formData: FormData,
): Promise<ActionResultWith<{ created: number; updated: number; unchanged: number }>> {
  try {
    return await applyInner(department, formData);
  } catch (err) {
    return actionFailure(err);
  }
}

async function applyInner(department: unknown, formData: unknown) {
  const { session, dept } = await authorise(department);
  const { rows, fileHash } = await readUpload(formData, dept);
  const hk = dept === StoreDepartment.HOUSEKEEPING;
  const byId = session.user.id;

  const outcome = await db.$transaction(
    async (tx) => {
      // Lock every existing item the file names, in id order (the same
      // discipline as every other stock movement), then plan against what
      // is under the lock — a receipt landing between preview and apply is
      // planned with, not overwritten.
      const named = new Set(rows.map((r) => nameKey(r.name)));
      const ids = (await loadExisting(tx, dept)).filter((e) => named.has(nameKey(e.name))).map((e) => e.id).sort();
      for (const id of ids) {
        if (hk) await tx.$executeRaw`SELECT 1 FROM "HousekeepingItem" WHERE "id" = ${id} FOR UPDATE`;
        else await tx.$executeRaw`SELECT 1 FROM "MaintenanceItem" WHERE "id" = ${id} FOR UPDATE`;
      }
      const plan = planUpload(rows, await loadExisting(tx, dept));
      const { problems, unchanged } = plan.summary;
      if (problems > 0) {
        throw new ActionError(
          `${problems} row${problems === 1 ? " has a problem" : "s have problems"} — fix the file and preview again. Nothing was changed.`,
        );
      }
      const fresh = plan.rows.filter((r) => r.status === "NEW");
      const changed = plan.rows.filter((r) => r.status === "UPDATE");
      if (fresh.length + changed.length === 0) return { created: 0, updated: 0, unchanged };

      const qty = (r: PlanRow) => r.qty ?? "0"; // never null on a NEW / UPDATE row
      const created =
        fresh.length === 0
          ? []
          : hk
            ? await tx.housekeepingItem.createManyAndReturn({
                data: fresh.map((r) => ({
                  name: r.name, unit: r.unit, reusable: r.reusable ?? false, minStock: r.minStock, currentStock: qty(r),
                })),
                select: { id: true, name: true },
              })
            : await tx.maintenanceItem.createManyAndReturn({
                data: fresh.map((r) => ({
                  name: r.name, unit: r.unit, category: r.category ?? undefined, minStock: r.minStock, currentStock: qty(r),
                })),
                select: { id: true, name: true },
              });
      const idOf = new Map(created.map((c) => [c.name, c.id]));

      // Opening stock arrives on a receipt — the same "Opening balance"
      // shape the new-item form writes — so the ledger replays to it. Zero
      // is "never counted": no line.
      const lines = fresh
        .filter((r) => new Decimal(qty(r)).gt(0))
        .map((r) => ({ itemId: idOf.get(r.name) ?? "", quantity: qty(r), costPerUnit: r.cost }));
      const receipt = {
        receivedAt: new Date(),
        recordedById: byId,
        sourceNote: "Opening balance (stock upload)",
        sourceContact: "Opening balance",
        lines: { create: lines },
      };
      const receiptId =
        lines.length === 0
          ? null
          : hk
            ? (await tx.housekeepingReceipt.create({ data: receipt, select: { id: true } })).id
            : (await tx.maintenanceReceipt.create({ data: receipt, select: { id: true } })).id;

      // Existing items: set on-hand to the count, and say so in the
      // adjustment ledger with before / after.
      const adjustments: Prisma.HousekeepingAdjustmentCreateManyInput[] = [];
      for (const r of changed) {
        const itemId = r.itemId ?? "";
        const before = r.before ?? "0";
        const after = qty(r);
        const { unit, minStock, reusable, category } = r.set;
        if (hk) {
          await tx.housekeepingItem.update({ where: { id: itemId }, data: { currentStock: after, unit, minStock, reusable } });
        } else {
          await tx.maintenanceItem.update({ where: { id: itemId }, data: { currentStock: after, unit, minStock, category } });
        }
        if (!new Decimal(after).eq(before)) {
          adjustments.push({
            itemId,
            kind: StoreAdjustmentKind.ADJUSTED,
            delta: new Decimal(after).minus(before).toString(),
            beforeQty: before,
            afterQty: after,
            reason: "Stock upload",
            byId,
          });
        }
      }
      if (adjustments.length > 0) {
        if (hk) await tx.housekeepingAdjustment.createMany({ data: adjustments });
        else await tx.maintenanceAdjustment.createMany({ data: adjustments });
      }

      const counts = { created: fresh.length, updated: changed.length, unchanged };
      await tx.auditLog.create({
        data: {
          userId: byId,
          action: hk ? "HK_STOCK_UPLOADED" : "MAINT_STOCK_UPLOADED",
          entity: receiptId ? (hk ? "HousekeepingReceipt" : "MaintenanceReceipt") : hk ? "HousekeepingItem" : "MaintenanceItem",
          entityId: receiptId ?? "stock-upload",
          payloadHash: sha256Json({
            department: dept,
            file: fileHash,
            ...counts,
            adjusted: adjustments.map((a) => ({ itemId: a.itemId, before: a.beforeQty, after: a.afterQty })),
          }),
        },
      });
      return counts;
    },
    // Up to 2,000 rows written one update at a time.
    { timeout: 120_000, maxWait: 15_000 },
  );

  const path = hk ? "/housekeeping" : "/maintenance";
  // A head resetting their whole shelf has no document behind the
  // UPDATE rows, so the manager hears about it — as with a hand adjustment.
  if (outcome.created + outcome.updated > 0 && session.user.role !== Role.ADMIN && session.user.role !== Role.MANAGER) {
    deferAfterResponse("dept-stock-upload:notify", () =>
      notifyRoles([Role.MANAGER], {
        kind: "GENERIC",
        title: `${hk ? "Housekeeping" : "Maintenance"} stock uploaded`,
        body: `${outcome.created} new item${outcome.created === 1 ? "" : "s"}, ${outcome.updated} updated — by ${session.user.name ?? session.user.email}`,
        link: `${path}/items`,
        dedupeKey: `dept-upload:${dept}:${fileHash}:${Date.now()}`,
      }),
    );
  }

  for (const p of ["", "/items", "/receipts", "/upload"]) revalidatePath(`${path}${p}`);
  return { ok: true as const, ...outcome };
}
