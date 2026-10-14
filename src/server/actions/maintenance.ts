"use server";

import { revalidatePath } from "next/cache";
import { JobPriority, MaintenanceActivityStatus, MaintenanceCategory, Prisma, Role } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { formatIST, istDayWindow, istToUtc } from "@/lib/time";
import { sha256Json } from "@/lib/audit";
import { deferAfterResponse } from "@/server/defer";
import { createNotification, notifyRoles } from "@/server/notification-core";
import {
  MaintenanceActivityInput,
  MaintenanceItemInput,
  MaintenanceReceiptInput,
  MaintenanceStaffInput,
} from "@/lib/validators";
import { MaintenanceAssignInput, MaintenanceJobStatusInput } from "@/lib/maintenance-job-validators";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

/**
 * Row-lock maintenance items for the rest of the transaction. Every stock
 * movement (receipt / activity consumption) reads or updates currentStock —
 * without the lock two concurrent movements read the same snapshot and one
 * update is silently lost (stock can even go negative past the availability
 * check). FOR UPDATE serialises them; ids are locked in a stable order so
 * concurrent multi-line movements can't deadlock.
 */
async function lockMaintenanceItemRows(tx: Prisma.TransactionClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$executeRaw`SELECT 1 FROM "MaintenanceItem" WHERE "id" = ${id} FOR UPDATE`;
  }
}

// Maintenance department — electrical + mechanical work at rooms, plus its
// own spares inventory (switches, pipes, bulbs, washers …).
// Rooms are reused from the housekeeping Room model.
//
// Who can do what:
//   MAINTENANCE_MANAGER:  runs the department — logs, assigns, starts and
//                         closes its own jobs (no approval), keeps the spares.
//   ADMIN / MANAGER:      the same, plus direct receipts (a correction path:
//                         stock normally arrives against an approved request).
//   HOUSEKEEPING_MANAGER: may REPORT a job (a PENDING activity with no
//                         spares and no technician) — they find most room
//                         defects; the maintenance desk takes it from there.

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER];
const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER];
const REPORT_ROLES = [...WRITE_ROLES, Role.HOUSEKEEPING_MANAGER];
const RECEIPT_ROLES = [Role.ADMIN, Role.MANAGER];

const OPEN_STATUSES: MaintenanceActivityStatus[] = ["PENDING", "IN_PROGRESS"];
const NOT_CANCELLED = { not: MaintenanceActivityStatus.CANCELLED } as const;

/** A stock quantity as stored: 3 dp, strictly positive — "0.0004" is nothing. */
function qty3(raw: string, what = "Quantity"): Decimal {
  const q = new Decimal(raw).toDecimalPlaces(3);
  if (q.lte(0)) throw new ActionError(`${what} must be more than 0 (to 3 decimals)`);
  return q;
}

/** Optional non-negative figure; blank → null. */
function nonNegative(raw: string | null | undefined, what: string): Decimal | null {
  if (!raw) return null;
  const d = new Decimal(raw);
  if (d.lt(0)) throw new ActionError(`${what} cannot be negative`);
  return d;
}

function parseWhen(raw: string, what: string): Date {
  const d = istToUtc(raw);
  if (Number.isNaN(d.getTime())) throw new ActionError(`Enter a valid ${what}`);
  return d;
}

/** A `<input type="date">` value as the IST day it names; null when malformed. */
function istDay(raw?: string) {
  const m = raw ? /^(\d{4}-\d{2}-\d{2})/.exec(raw) : null;
  if (!m) return null;
  const w = istDayWindow(istToUtc(`${m[1]}T00:00:00`));
  return Number.isNaN(w.from.getTime()) ? null : w;
}

/** Half-open [from 00:00, to 24:00) IST — the "to" day is included. */
function dayRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const f = istDay(from);
  const t = istDay(to);
  if (!f && !t) return undefined;
  return { ...(f ? { gte: f.from } : {}), ...(t ? { lt: t.toExclusive } : {}) };
}

// ─── Staff ────────────────────────────────────────────────────────────

export async function upsertMaintenanceStaff(
  raw: unknown,
  id?: string,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await upsertMaintenanceStaffInner(raw, id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function upsertMaintenanceStaffInner(
  raw: unknown,
  id?: string,
): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = MaintenanceStaffInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    const clash = await tx.maintenanceStaff.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" }, NOT: id ? { id } : undefined },
      select: { id: true },
    });
    if (clash) throw new ActionError(`A staff member named "${input.name}" already exists`);
    const data = {
      name: input.name,
      phone: input.phone || null,
      category: input.category,
      notes: input.notes || null,
      active: input.active ?? true,
    };
    if (id) {
      const updated = await tx.maintenanceStaff.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MAINT_STAFF_UPDATED",
          entity: "MaintenanceStaff",
          entityId: updated.id,
        },
      });
      return updated;
    }
    const created = await tx.maintenanceStaff.create({ data });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MAINT_STAFF_CREATED",
        entity: "MaintenanceStaff",
        entityId: created.id,
      },
    });
    return created;
  });

  revalidatePath("/maintenance/staff");
  return { ok: true, id: row.id };
}

export async function deactivateMaintenanceStaff(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    await db.$transaction(async (tx) => {
      await tx.maintenanceStaff.update({ where: { id }, data: { active: false } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MAINT_STAFF_DEACTIVATED",
          entity: "MaintenanceStaff",
          entityId: id,
        },
      });
    });
    revalidatePath("/maintenance/staff");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function deleteMaintenanceStaff(id: string): Promise<ActionResult> {
  try {
    return await deleteMaintenanceStaffInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function deleteMaintenanceStaffInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const activities = await db.maintenanceActivity.count({ where: { staffId: id } });
  if (activities > 0) {
    throw new ActionError(
      `This staff member has ${activities} historical activit${activities === 1 ? "y" : "ies"}. Deactivate instead to keep the audit trail.`
    );
  }
  await db.$transaction(async (tx) => {
    await tx.maintenanceStaff.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MAINT_STAFF_DELETED",
        entity: "MaintenanceStaff",
        entityId: id,
      },
    });
  });
  revalidatePath("/maintenance/staff");
  return { ok: true };
}

export async function listMaintenanceStaff(opts: { activeOnly?: boolean } = {}) {
  await requireRole(READ_ROLES);
  return db.maintenanceStaff.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

// ─── Items ────────────────────────────────────────────────────────────

export async function upsertMaintenanceItem(
  raw: unknown,
  id?: string,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await upsertMaintenanceItemInner(raw, id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function upsertMaintenanceItemInner(
  raw: unknown,
  id?: string,
): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = MaintenanceItemInput.parse(raw);
  const minStock = nonNegative(input.minStock, "Low-stock level");
  const opening = nonNegative(input.openingStock, "Opening stock");

  const row = await db.$transaction(async (tx) => {
    const clash = await tx.maintenanceItem.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" }, NOT: id ? { id } : undefined },
      select: { id: true },
    });
    if (clash) throw new ActionError(`An item named "${input.name}" already exists`);
    const data = {
      name: input.name,
      sku: input.sku || null,
      unit: input.unit,
      category: input.category,
      minStock,
      // Omitted = untouched; the item form has no notes field.
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      active: input.active ?? true,
    };
    if (id) {
      await lockMaintenanceItemRows(tx, [id]);
      const existing = await tx.maintenanceItem.findUnique({
        where: { id },
        select: {
          unit: true,
          currentStock: true,
          _count: { select: { receiptLines: true, activityLines: true, purchaseLines: true } },
        },
      });
      if (!existing) throw new ActionError("Item not found");
      // Every stored quantity is in the old unit; relabelling them would
      // turn 3 m of cable into 3 pieces.
      if (
        existing.unit !== input.unit &&
        (new Decimal(existing.currentStock.toString()).gt(0) ||
          existing._count.receiptLines > 0 ||
          existing._count.activityLines > 0 ||
          // a stock request approved in the old unit counts too
          existing._count.purchaseLines > 0)
      ) {
        throw new ActionError(
          `Unit can't change from "${existing.unit}" once the item has stock or history — add a new item instead`
        );
      }
      const updated = await tx.maintenanceItem.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MAINT_ITEM_UPDATED",
          entity: "MaintenanceItem",
          entityId: updated.id,
        },
      });
      return updated;
    }
    const created = await tx.maintenanceItem.create({
      data: { ...data, currentStock: opening ?? new Decimal(0) },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MAINT_ITEM_CREATED",
        entity: "MaintenanceItem",
        entityId: created.id,
      },
    });
    if (opening && opening.gt(0)) {
      const receipt = await tx.maintenanceReceipt.create({
        data: {
          receivedAt: new Date(),
          recordedById: session.user.id,
          sourceNote: "Opening balance (set during item creation)",
          sourceContact: "Opening balance",
          lines: { create: [{ itemId: created.id, quantity: opening }] },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MAINT_OPENING_BALANCE_SET",
          entity: "MaintenanceReceipt",
          entityId: receipt.id,
          payloadHash: sha256Json({ itemId: created.id, quantity: opening.toString() }),
        },
      });
    }
    return created;
  });

  revalidatePath("/maintenance/items");
  revalidatePath("/maintenance/receipts");
  revalidatePath("/maintenance");
  return { ok: true, id: row.id };
}

export async function deactivateMaintenanceItem(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    await db.$transaction(async (tx) => {
      await lockMaintenanceItemRows(tx, [id]);
      const item = await tx.maintenanceItem.findUnique({
        where: { id },
        select: { name: true, unit: true, currentStock: true },
      });
      if (!item) throw new ActionError("Item not found");
      if (new Decimal(item.currentStock.toString()).gt(0)) {
        throw new ActionError(
          `${item.name} still has ${item.currentStock.toString()} ${item.unit} in stock — adjust it to zero before hiding it`
        );
      }
      await tx.maintenanceItem.update({ where: { id }, data: { active: false } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MAINT_ITEM_DEACTIVATED",
          entity: "MaintenanceItem",
          entityId: id,
        },
      });
    });
    revalidatePath("/maintenance/items");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function deleteMaintenanceItem(id: string): Promise<ActionResult> {
  try {
    return await deleteMaintenanceItemInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function deleteMaintenanceItemInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    // Every row that names the item. Each one either blocks the delete at the
    // database (a raw FK error) or would lose its link, so refuse by name.
    // Inside the txn so a line booked in between can't slip past.
    const [receiptLines, activityLines, adjustments, requestLines] = await Promise.all([
      tx.maintenanceReceiptLine.count({ where: { itemId: id } }),
      tx.maintenanceActivityLine.count({ where: { itemId: id } }),
      tx.maintenanceAdjustment.count({ where: { itemId: id } }),
      tx.deptPurchaseOrderLine.count({ where: { mtItemId: id } }),
    ]);
    const bits: string[] = [];
    if (receiptLines > 0) bits.push(`${receiptLines} receipt line${receiptLines === 1 ? "" : "s"}`);
    if (activityLines > 0) bits.push(`${activityLines} activity line${activityLines === 1 ? "" : "s"}`);
    if (adjustments > 0) bits.push(`${adjustments} adjustment${adjustments === 1 ? "" : "s"}`);
    if (requestLines > 0) bits.push(`${requestLines} stock request line${requestLines === 1 ? "" : "s"}`);
    if (bits.length > 0) {
      throw new ActionError(
        `This item has history (${bits.join(" + ")}). Deactivate instead to keep the audit trail.`
      );
    }
    await tx.maintenanceItem.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MAINT_ITEM_DELETED",
        entity: "MaintenanceItem",
        entityId: id,
      },
    });
  });
  revalidatePath("/maintenance/items");
  revalidatePath("/maintenance");
  return { ok: true };
}

export async function listMaintenanceItems(opts: { activeOnly?: boolean; category?: MaintenanceCategory } = {}) {
  await requireRole(READ_ROLES);
  return db.maintenanceItem.findMany({
    where: {
      ...(opts.activeOnly ? { active: true } : {}),
      ...(opts.category ? { category: opts.category } : {}),
    },
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
  });
}

// ─── Receipts ─────────────────────────────────────────────────────────

export async function recordMaintenanceReceipt(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordMaintenanceReceiptInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordMaintenanceReceiptInner(raw: unknown): Promise<{ ok: true; id: string }> {
  // Stock comes in against an approved stock request (/maintenance/purchase);
  // a bare receipt is management's correction path, not the desk's.
  const session = await requireRole(RECEIPT_ROLES);
  const input = MaintenanceReceiptInput.parse(raw);
  const receivedAt = parseWhen(input.receivedAt, "received date");

  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    qty: qty3(l.quantity),
    costPerUnit: nonNegative(l.costPerUnit, "Cost per unit"),
  }));
  const itemIds = [...new Set(lines.map((l) => l.itemId))].sort();

  const receipt = await db.$transaction(async (tx) => {
    await lockMaintenanceItemRows(tx, itemIds);
    const items = await tx.maintenanceItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, active: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of itemIds) {
      const it = byId.get(id);
      if (!it) throw new ActionError("Item not found — refresh the list and try again");
      if (!it.active) throw new ActionError(`${it.name} is hidden — unhide it before receiving it`);
    }
    const created = await tx.maintenanceReceipt.create({
      data: {
        receivedAt,
        recordedById: session.user.id,
        sourceNote: input.sourceNote || null,
        sourceContact: input.sourceContact || null,
        lines: {
          create: lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.qty,
            costPerUnit: l.costPerUnit,
          })),
        },
      },
    });
    for (const l of lines) {
      await tx.maintenanceItem.update({
        where: { id: l.itemId },
        data: { currentStock: { increment: l.qty } },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MAINT_RECEIPT_CREATED",
        entity: "MaintenanceReceipt",
        entityId: created.id,
        payloadHash: sha256Json({
          receivedAt: receivedAt.toISOString(),
          lines: lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.qty.toString(),
            costPerUnit: l.costPerUnit?.toString() ?? null,
          })),
        }),
      },
    });
    return created;
  });

  revalidatePath("/maintenance/receipts");
  revalidatePath("/maintenance/items");
  revalidatePath("/maintenance");
  return { ok: true, id: receipt.id };
}

export async function listMaintenanceReceipts(opts: { limit?: number } = {}) {
  await requireRole(READ_ROLES);
  return db.maintenanceReceipt.findMany({
    take: opts.limit ?? 100,
    orderBy: { receivedAt: "desc" },
    include: {
      recordedBy: { select: { id: true, name: true } },
      purchaseOrder: { select: { number: true } },
      lines: { include: { item: { select: { id: true, name: true, unit: true, category: true } } } },
    },
  });
}

// ─── Activities (work performed at room) ──────────────────────────────

interface LowStockItem {
  id: string;
  name: string;
  unit: string;
  onHand: string;
}

/** Items an activity just took to (or below) their floor — once a day each. */
function notifyLowStock(crossed: LowStockItem[]) {
  if (crossed.length === 0) return;
  const day = formatIST(new Date(), "yyyy-MM-dd");
  deferAfterResponse("maintenance:low-stock:notify", () =>
    Promise.all(
      crossed.map((i) =>
        notifyRoles([Role.MAINTENANCE_MANAGER, Role.MANAGER], {
          kind: "GENERIC",
          title: "Maintenance stock low",
          body: `${i.name}: ${i.onHand} ${i.unit} left`,
          link: "/maintenance/items",
          dedupeKey: `maint-low:${i.id}:${day}`,
        }),
      ),
    ),
  );
}

/**
 * Take a job's spares off the shelf: one total per item (two lines naming
 * the same spare are one draw on it), checked against on-hand under the row
 * lock — a pre-check outside the txn could pass for two concurrent jobs that
 * together overdraw. Writes the lines and the decrements; returns the items
 * this took to (or below) their floor.
 */
async function drawSpares(
  tx: Prisma.TransactionClient,
  activityId: string,
  lines: { itemId: string; qty: Decimal }[],
): Promise<LowStockItem[]> {
  if (lines.length === 0) return [];
  const need = new Map<string, Decimal>();
  for (const l of lines) need.set(l.itemId, (need.get(l.itemId) ?? new Decimal(0)).plus(l.qty));
  const itemIds = [...need.keys()].sort();

  await lockMaintenanceItemRows(tx, itemIds);
  const items = await tx.maintenanceItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, unit: true, active: true, currentStock: true, minStock: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const crossed: LowStockItem[] = [];
  for (const id of itemIds) {
    const it = byId.get(id);
    if (!it) throw new ActionError("Item not found — refresh the list and try again");
    if (!it.active) throw new ActionError(`${it.name} is hidden — unhide it before drawing it`);
    const have = new Decimal(it.currentStock.toString());
    const take = need.get(id)!;
    if (have.lt(take)) {
      throw new ActionError(
        `Not enough ${it.name} in stock: this job needs ${take.toString()} ${it.unit} across its lines, have ${have.toString()}`
      );
    }
    const after = have.minus(take);
    const floor = it.minStock ? new Decimal(it.minStock.toString()) : new Decimal(0);
    if (have.gt(floor) && after.lte(floor)) {
      crossed.push({ id, name: it.name, unit: it.unit, onHand: after.toString() });
    }
  }

  await tx.maintenanceActivityLine.createMany({
    data: lines.map((l) => ({ activityId, itemId: l.itemId, quantity: l.qty })),
  });
  for (const id of itemIds) {
    await tx.maintenanceItem.update({
      where: { id },
      data: { currentStock: { decrement: need.get(id)! } },
    });
  }
  return crossed;
}

/** The technician a job is being given to — present and still on the books. */
async function activeStaff(tx: Prisma.TransactionClient, staffId: string) {
  const staff = await tx.maintenanceStaff.findUnique({
    where: { id: staffId },
    select: { name: true, active: true },
  });
  if (!staff) throw new ActionError("Staff member not found");
  if (!staff.active) throw new ActionError(`${staff.name} is inactive — pick an active staff member`);
  return staff;
}

export async function recordMaintenanceActivity(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordMaintenanceActivityInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordMaintenanceActivityInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(REPORT_ROLES);
  const input = MaintenanceActivityInput.parse(raw);
  const performedAt = parseWhen(input.performedAt, "date and time");

  // Housekeeping reports the defect; the maintenance desk takes it from
  // there. Their job is born PENDING and unassigned, and never touches the
  // spares shelf.
  const reportOnly = session.user.role === Role.HOUSEKEEPING_MANAGER;
  if (reportOnly && input.lines.length > 0) {
    throw new ActionError("Housekeeping can report a job, not draw spares");
  }
  const status = reportOnly ? MaintenanceActivityStatus.PENDING : input.status;
  const staffId = reportOnly ? null : input.staffId || null;
  const workDone = reportOnly ? null : input.workDone || null;
  if (!staffId && status !== MaintenanceActivityStatus.PENDING) {
    throw new ActionError("Pick the staff member doing the work — only a pending job can wait unassigned");
  }
  if (status === MaintenanceActivityStatus.COMPLETED && !workDone) {
    throw new ActionError("Say what work was done — a completed job records it");
  }
  const lines = input.lines.map((l) => ({ itemId: l.itemId, qty: qty3(l.quantity) }));
  const now = new Date();

  const outcome = await db.$transaction(async (tx) => {
    if (staffId) await activeStaff(tx, staffId);
    const room = await tx.room.findUnique({
      where: { id: input.roomId },
      select: { number: true, active: true },
    });
    if (!room) throw new ActionError("Room not found");
    if (!room.active) throw new ActionError(`Room ${room.number} is inactive`);

    const created = await tx.maintenanceActivity.create({
      data: {
        performedAt,
        recordedById: session.user.id,
        staffId,
        roomId: input.roomId,
        category: input.category,
        priority: input.priority,
        status,
        // A job logged as already done has no start to measure, so it stays
        // out of the time-to-close figure (getMaintenanceJobStats).
        startedAt: status === MaintenanceActivityStatus.IN_PROGRESS ? now : null,
        completedAt: status === MaintenanceActivityStatus.COMPLETED ? now : null,
        issueReported: input.issueReported,
        workDone,
        notes: input.notes || null,
      },
    });
    const crossed = await drawSpares(tx, created.id, lines);
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MAINT_ACTIVITY_CREATED",
        entity: "MaintenanceActivity",
        entityId: created.id,
        payloadHash: sha256Json({
          performedAt: performedAt.toISOString(),
          staffId,
          roomId: input.roomId,
          category: input.category,
          priority: input.priority,
          status,
          lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty.toString() })),
        }),
      },
    });
    return { id: created.id, room: room.number, crossed };
  });

  if (status === MaintenanceActivityStatus.PENDING && session.user.role !== Role.MAINTENANCE_MANAGER) {
    deferAfterResponse("maintenance:activity:reported", () =>
      notifyRoles([Role.MAINTENANCE_MANAGER], {
        kind: "GENERIC",
        title: input.priority === "URGENT" ? "URGENT maintenance job reported" : "Maintenance job reported",
        body: `Room ${outcome.room}: ${input.issueReported} — by ${session.user.name ?? session.user.email}`,
        link: "/maintenance/activities?status=PENDING",
        dedupeKey: `maint-act:${outcome.id}`,
      }),
    );
  }
  notifyLowStock(outcome.crossed);

  revalidatePath("/maintenance/activities");
  revalidatePath("/maintenance/items");
  revalidatePath("/maintenance");
  return { ok: true, id: outcome.id };
}

/** Which statuses a job may leave for each target. COMPLETED and CANCELLED are terminal. */
const STATUS_FROM: Record<"IN_PROGRESS" | "COMPLETED" | "CANCELLED", MaintenanceActivityStatus[]> = {
  IN_PROGRESS: ["PENDING"],
  COMPLETED: ["PENDING", "IN_PROGRESS"],
  CANCELLED: ["PENDING", "IN_PROGRESS"],
};

const STATUS_LABEL: Record<MaintenanceActivityStatus, string> = {
  PENDING: "pending",
  IN_PROGRESS: "in progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

/**
 * Move a job along. IN_PROGRESS stamps startedAt; IN_PROGRESS and COMPLETED
 * need a technician (pass `staffId` to assign on the way); COMPLETED needs
 * `workDone` and takes `parts` — the spares actually used, drawn from stock
 * in the same transaction. CANCELLED puts every drawn spare back.
 */
export async function updateMaintenanceActivityStatus(
  id: string,
  input: {
    status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    workDone?: string | null;
    note?: string | null;
    staffId?: string | null;
    parts?: { itemId: string; qty: string }[];
  },
): Promise<ActionResult> {
  try {
    return await updateMaintenanceActivityStatusInner(id, input);
  } catch (err) {
    return actionFailure(err);
  }
}

async function updateMaintenanceActivityStatusInner(id: string, raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = MaintenanceJobStatusInput.parse(raw);
  if (input.parts.length > 0 && input.status !== "COMPLETED") {
    throw new ActionError("Spares are recorded when the job is completed");
  }
  const parts = input.parts.map((p) => ({ itemId: p.itemId, qty: qty3(p.qty) }));
  // Nobody is assigned to a job on its way to the bin.
  const assign = input.status === "CANCELLED" ? null : input.staffId || null;
  const workDone = input.workDone || null;
  const now = new Date();

  const outcome = await db.$transaction(async (tx) => {
    const job = await tx.maintenanceActivity.findUnique({
      where: { id },
      select: {
        status: true,
        staffId: true,
        startedAt: true,
        recordedById: true,
        issueReported: true,
        notes: true,
        room: { select: { number: true } },
        lines: { select: { itemId: true, quantity: true } },
      },
    });
    if (!job) throw new ActionError("Job not found");
    if (job.status === "COMPLETED") throw new ActionError("This job is already completed");
    if (job.status === "CANCELLED") throw new ActionError("This job was cancelled");
    if (job.status === input.status) throw new ActionError(`This job is already ${STATUS_LABEL[job.status]}`);
    if (assign) await activeStaff(tx, assign);
    if (input.status !== "CANCELLED" && !(assign ?? job.staffId)) {
      throw new ActionError(
        `Assign a staff member before ${input.status === "IN_PROGRESS" ? "starting" : "completing"} this job`,
      );
    }
    if (input.status === "COMPLETED" && !workDone) {
      throw new ActionError("Say what work was done before completing the job");
    }

    const flipped = await tx.maintenanceActivity.updateMany({
      where: { id, status: { in: STATUS_FROM[input.status] } },
      data: {
        status: input.status,
        ...(assign ? { staffId: assign } : {}),
        ...(input.status === "IN_PROGRESS" ? { startedAt: now } : {}),
        // Completed straight from pending: started and finished in one go.
        ...(input.status === "COMPLETED" ? { completedAt: now, workDone, startedAt: job.startedAt ?? now } : {}),
        ...(input.status === "CANCELLED" ? { cancelledAt: now } : {}),
        ...(input.note ? { notes: job.notes ? `${job.notes}\n${input.note}` : input.note } : {}),
      },
    });
    if (flipped.count !== 1) throw new ActionError("This job changed under you — refresh and try again");

    // The flip above holds the job's row, so a second completion racing this
    // one waits, finds it COMPLETED and draws nothing.
    const crossed = input.status === "COMPLETED" ? await drawSpares(tx, id, parts) : [];

    // A cancelled job never happened: its spares go back on the shelf, one
    // readable RESTORED record per line so the movement can be traced.
    if (input.status === "CANCELLED" && job.lines.length > 0) {
      const itemIds = [...new Set(job.lines.map((l) => l.itemId))].sort();
      await lockMaintenanceItemRows(tx, itemIds);
      const items = await tx.maintenanceItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, currentStock: true },
      });
      const onHand = new Map(items.map((i) => [i.id, new Decimal(i.currentStock.toString())]));
      for (const line of job.lines) {
        const before = onHand.get(line.itemId);
        if (!before) throw new ActionError("An item on this job no longer exists");
        const qty = new Decimal(line.quantity.toString());
        const after = before.plus(qty);
        onHand.set(line.itemId, after);
        await tx.maintenanceItem.update({
          where: { id: line.itemId },
          data: { currentStock: after.toString() },
        });
        await tx.maintenanceAdjustment.create({
          data: {
            itemId: line.itemId,
            kind: "RESTORED",
            delta: qty.toString(),
            beforeQty: before.toString(),
            afterQty: after.toString(),
            reason: "Job cancelled",
            activityId: id,
            byId: session.user.id,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MAINT_ACTIVITY_STATUS_CHANGED",
        entity: "MaintenanceActivity",
        entityId: id,
        payloadHash: sha256Json({
          from: job.status,
          to: input.status,
          staffId: assign ?? job.staffId,
          workDone: input.status === "COMPLETED" ? workDone : null,
          parts: parts.map((p) => ({ itemId: p.itemId, quantity: p.qty.toString() })),
        }),
      },
    });
    return { recordedById: job.recordedById, room: job.room.number, issue: job.issueReported, crossed };
  });

  const by = session.user.name ?? session.user.email;
  const link = "/maintenance/activities";
  if (input.status === "COMPLETED") {
    const payload = {
      kind: "GENERIC" as const,
      title: "Maintenance job completed",
      body: `Room ${outcome.room}: ${outcome.issue} — by ${by}`,
      link,
      dedupeKey: `maint-act-done:${id}`,
    };
    deferAfterResponse("maintenance:activity:completed", async () => {
      if (outcome.recordedById !== session.user.id) {
        await createNotification({ userId: outcome.recordedById, ...payload });
      }
      await notifyRoles([Role.MANAGER], payload);
    });
  } else if (input.status === "CANCELLED") {
    deferAfterResponse("maintenance:activity:cancelled", () =>
      notifyRoles([Role.MANAGER], {
        kind: "GENERIC",
        title: "Maintenance job cancelled",
        body: `Room ${outcome.room}: ${outcome.issue} — by ${by}`,
        link,
        dedupeKey: `maint-act-cancel:${id}`,
      }),
    );
  }
  notifyLowStock(outcome.crossed);

  revalidatePath("/maintenance/activities");
  revalidatePath("/maintenance/items");
  revalidatePath("/maintenance");
  return { ok: true };
}

/** Give an open job to a technician (or hand it to another one). */
export async function assignMaintenanceActivity(id: string, staffId: string): Promise<ActionResult> {
  try {
    return await assignMaintenanceActivityInner(id, staffId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function assignMaintenanceActivityInner(id: string, rawStaffId: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const { staffId } = MaintenanceAssignInput.parse({ staffId: rawStaffId });

  await db.$transaction(async (tx) => {
    const job = await tx.maintenanceActivity.findUnique({
      where: { id },
      select: { status: true, staffId: true },
    });
    if (!job) throw new ActionError("Job not found");
    if (!OPEN_STATUSES.includes(job.status)) {
      throw new ActionError(`This job is ${STATUS_LABEL[job.status]} — only an open job can be assigned`);
    }
    if (job.staffId === staffId) throw new ActionError("This job is already with that staff member");
    await activeStaff(tx, staffId);
    const moved = await tx.maintenanceActivity.updateMany({
      where: { id, status: { in: OPEN_STATUSES } },
      data: { staffId },
    });
    if (moved.count !== 1) throw new ActionError("This job changed under you — refresh and try again");
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MAINT_ACTIVITY_ASSIGNED",
        entity: "MaintenanceActivity",
        entityId: id,
        payloadHash: sha256Json({ from: job.staffId, to: staffId }),
      },
    });
  });

  revalidatePath("/maintenance/activities");
  revalidatePath("/maintenance");
  return { ok: true };
}

export type ActivitySort = "priority" | "oldest" | "newest";

const ACTIVITY_ORDER: Record<ActivitySort, Prisma.MaintenanceActivityOrderByWithRelationInput[]> = {
  // JobPriority is declared LOW → URGENT, and Postgres sorts an enum in
  // declaration order: desc puts URGENT first. Ties go oldest first.
  priority: [{ priority: "desc" }, { performedAt: "asc" }],
  oldest: [{ performedAt: "asc" }],
  newest: [{ performedAt: "desc" }],
};

export interface ListActivitiesOpts {
  from?: string;
  to?: string;
  roomId?: string;
  staffId?: string;
  /** Jobs nobody has taken yet; wins over `staffId`. */
  unassigned?: boolean;
  itemId?: string;
  category?: MaintenanceCategory;
  priority?: JobPriority;
  status?: MaintenanceActivityStatus;
  /** PENDING + IN_PROGRESS; wins over `status`. */
  open?: boolean;
  /** Default newest first. */
  sort?: ActivitySort;
  limit?: number;
}

export async function listMaintenanceActivities(opts: ListActivitiesOpts = {}) {
  await requireRole(READ_ROLES);
  const where: Prisma.MaintenanceActivityWhereInput = {};
  const range = dayRange(opts.from, opts.to);
  if (range) where.performedAt = range;
  if (opts.roomId) where.roomId = opts.roomId;
  if (opts.unassigned) where.staffId = null;
  else if (opts.staffId) where.staffId = opts.staffId;
  if (opts.category) where.category = opts.category;
  if (opts.priority) where.priority = opts.priority;
  if (opts.open) where.status = { in: OPEN_STATUSES };
  else if (opts.status) where.status = opts.status;
  if (opts.itemId) where.lines = { some: { itemId: opts.itemId } };

  return db.maintenanceActivity.findMany({
    where,
    take: opts.limit ?? 300,
    orderBy: ACTIVITY_ORDER[opts.sort ?? "newest"],
    include: {
      recordedBy: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true, category: true } },
      room: { select: { id: true, number: true, name: true } },
      lines: { include: { item: { select: { id: true, name: true, unit: true, category: true } } } },
    },
  });
}

// ─── Reports ──────────────────────────────────────────────────────────
// Every report leaves CANCELLED out: a cancelled job did no work and drew
// no spares (they went back on the shelf).

export type MaintenancePeriod = "WEEK" | "MONTH" | "QUARTER" | "CUSTOM";

function periodRange(p: MaintenancePeriod, from?: string, to?: string): Prisma.DateTimeFilter {
  const now = new Date();
  if (p === "CUSTOM") {
    return {
      gte: istDay(from)?.from ?? new Date(now.getFullYear(), 0, 1),
      lt: istDay(to)?.toExclusive ?? now,
    };
  }
  const days = p === "WEEK" ? 7 : p === "MONTH" ? 30 : 90;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return { gte: d, lt: now };
}

/** Activity counts by category over the period. */
export async function activitiesByCategory(
  period: MaintenancePeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const grouped = await db.maintenanceActivity.groupBy({
    by: ["category"],
    where: { performedAt: periodRange(period, opts.from, opts.to), status: NOT_CANCELLED },
    _count: { _all: true },
  });
  return grouped.map((g) => ({ category: g.category, count: g._count._all }));
}

/** Item consumption by item, with current stock and unit. */
export async function maintenanceConsumptionByItem(
  period: MaintenancePeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const grouped = await db.maintenanceActivityLine.groupBy({
    by: ["itemId"],
    where: { activity: { performedAt: periodRange(period, opts.from, opts.to), status: NOT_CANCELLED } },
    _sum: { quantity: true },
  });
  const items = await db.maintenanceItem.findMany({
    where: { id: { in: grouped.map((g) => g.itemId) } },
    select: { id: true, name: true, unit: true, category: true, currentStock: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  return grouped
    .map((g) => ({
      itemId: g.itemId,
      name: byId.get(g.itemId)?.name ?? "—",
      unit: byId.get(g.itemId)?.unit ?? "",
      category: byId.get(g.itemId)?.category ?? "GENERAL",
      currentStock: byId.get(g.itemId)?.currentStock.toString() ?? "0",
      consumed: g._sum.quantity?.toString() ?? "0",
    }))
    .sort((a, b) => Number(b.consumed) - Number(a.consumed));
}

/** Activities per room — how often each room needed maintenance. */
export async function activitiesByRoom(
  period: MaintenancePeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const grouped = await db.maintenanceActivity.groupBy({
    by: ["roomId"],
    where: { performedAt: periodRange(period, opts.from, opts.to), status: NOT_CANCELLED },
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];
  const rooms = await db.room.findMany({
    where: { id: { in: grouped.map((g) => g.roomId) } },
    select: { id: true, number: true, name: true },
  });
  const byId = new Map(rooms.map((r) => [r.id, r]));
  return grouped
    .map((g) => ({
      roomId: g.roomId,
      roomNumber: byId.get(g.roomId)?.number ?? "—",
      roomName: byId.get(g.roomId)?.name ?? null,
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Activities per staff — workload distribution. */
export async function activitiesByStaff(
  period: MaintenancePeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const grouped = await db.maintenanceActivity.groupBy({
    by: ["staffId"],
    where: { performedAt: periodRange(period, opts.from, opts.to), status: NOT_CANCELLED },
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];
  const staff = await db.maintenanceStaff.findMany({
    where: { id: { in: grouped.map((g) => g.staffId).filter((id): id is string => id !== null) } },
    select: { id: true, name: true, category: true },
  });
  const byId = new Map(staff.map((s) => [s.id, s]));
  return grouped
    .map((g) => ({
      staffId: g.staffId,
      staffName: (g.staffId && byId.get(g.staffId)?.name) || "Unassigned",
      category: (g.staffId && byId.get(g.staffId)?.category) || "GENERAL",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The job desk at a glance: open jobs by priority, the oldest one still
 * open, and how long a job takes from logged to completed over the period.
 */
export async function getMaintenanceJobStats(
  period: MaintenancePeriod = "MONTH",
  opts: { from?: string; to?: string } = {},
) {
  await requireRole(READ_ROLES);
  const openWhere = { status: { in: OPEN_STATUSES } };
  const [open, oldest, closed] = await Promise.all([
    db.maintenanceActivity.groupBy({ by: ["priority"], where: openWhere, _count: { _all: true } }),
    db.maintenanceActivity.findFirst({
      where: openWhere,
      orderBy: { performedAt: "asc" },
      select: { performedAt: true },
    }),
    // Jobs logged as already done carry no startedAt — nothing to measure.
    // ponytail: averaged in JS over at most 5000 rows; AVG() in SQL if the
    // period ever holds more.
    db.maintenanceActivity.findMany({
      where: {
        status: MaintenanceActivityStatus.COMPLETED,
        completedAt: periodRange(period, opts.from, opts.to),
        startedAt: { not: null },
      },
      select: { performedAt: true, completedAt: true },
      take: 5000,
    }),
  ]);

  const openByPriority: Record<JobPriority, number> = { LOW: 0, NORMAL: 0, HIGH: 0, URGENT: 0 };
  for (const g of open) openByPriority[g.priority] = g._count._all;
  const hours = closed.map(
    (c) => Math.max(0, (c.completedAt ?? c.performedAt).getTime() - c.performedAt.getTime()) / 3_600_000,
  );
  return {
    openByPriority,
    oldestOpenAt: oldest?.performedAt ?? null,
    closedCount: hours.length,
    avgHoursToClose: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
  };
}

/** Top-line counters for the maintenance dashboard. */
export async function maintenanceSummary() {
  await requireRole(READ_ROLES);
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [itemCount, activeItems, recentReceipts, recentActivities, open] =
    await Promise.all([
      db.maintenanceItem.count({ where: { active: true } }),
      db.maintenanceItem.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          unit: true,
          category: true,
          currentStock: true,
          minStock: true,
        },
      }),
      db.maintenanceReceipt.count({ where: { receivedAt: { gte: oneWeekAgo } } }),
      db.maintenanceActivity.count({
        where: { performedAt: { gte: oneWeekAgo }, status: NOT_CANCELLED },
      }),
      db.maintenanceActivity.count({ where: { status: { in: OPEN_STATUSES } } }),
    ]);

  // Out of stock is low whatever the threshold says (or doesn't).
  const lows = activeItems
    .filter((i) => {
      const cur = new Decimal(i.currentStock.toString());
      return cur.lte(0) || (i.minStock != null && cur.lte(new Decimal(i.minStock.toString())));
    })
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      category: i.category,
      currentStock: i.currentStock.toString(),
      minStock: i.minStock?.toString() ?? "—",
    }));

  const topConsumed = await maintenanceConsumptionByItem("WEEK");
  const byCat = await activitiesByCategory("WEEK");
  const jobs = await getMaintenanceJobStats("WEEK");

  return {
    itemCount,
    lowStock: lows,
    receiptsLastWeek: recentReceipts,
    activitiesLastWeek: recentActivities,
    pendingActivities: open,
    topItemsThisWeek: topConsumed.slice(0, 5),
    byCategoryThisWeek: byCat,
    openByPriority: jobs.openByPriority,
    oldestOpenAt: jobs.oldestOpenAt,
  };
}
