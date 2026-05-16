"use server";

import { revalidatePath } from "next/cache";
import { MaintenanceCategory, Prisma, Role } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { istToUtc } from "@/lib/time";
import {
  MaintenanceActivityInput,
  MaintenanceItemInput,
  MaintenanceReceiptInput,
  MaintenanceStaffInput,
} from "@/lib/validators";

// Maintenance department — electrical + mechanical work at rooms, plus its
// own spares inventory (switches, pipes, bulbs, washers …).
// Rooms are reused from the housekeeping Room model.
//
// Who can do what:
//   MAINTENANCE_MANAGER: full read+write on this module.
//   ADMIN / MANAGER:     full read+write (oversight + reports).

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER];
const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER];

// ─── Staff ────────────────────────────────────────────────────────────

export async function upsertMaintenanceStaff(raw: unknown, id?: string) {
  const session = await requireRole(WRITE_ROLES);
  const input = MaintenanceStaffInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    if (id) {
      const updated = await tx.maintenanceStaff.update({
        where: { id },
        data: {
          name: input.name,
          phone: input.phone ?? null,
          category: input.category,
          notes: input.notes ?? null,
          active: input.active ?? true,
        },
      });
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
    const created = await tx.maintenanceStaff.create({
      data: {
        name: input.name,
        phone: input.phone ?? null,
        category: input.category,
        notes: input.notes ?? null,
        active: input.active ?? true,
      },
    });
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
  return { id: row.id };
}

export async function deactivateMaintenanceStaff(id: string) {
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
}

export async function deleteMaintenanceStaff(id: string) {
  const session = await requireRole(WRITE_ROLES);
  const activities = await db.maintenanceActivity.count({ where: { staffId: id } });
  if (activities > 0) {
    throw new Error(
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
}

export async function listMaintenanceStaff(opts: { activeOnly?: boolean } = {}) {
  await requireRole(READ_ROLES);
  return db.maintenanceStaff.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

// ─── Items ────────────────────────────────────────────────────────────

export async function upsertMaintenanceItem(raw: unknown, id?: string) {
  const session = await requireRole(WRITE_ROLES);
  const input = MaintenanceItemInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    if (id) {
      const updated = await tx.maintenanceItem.update({
        where: { id },
        data: {
          name: input.name,
          sku: input.sku ?? null,
          unit: input.unit,
          category: input.category,
          minStock: input.minStock ? new Prisma.Decimal(input.minStock) : null,
          notes: input.notes ?? null,
          active: input.active ?? true,
        },
      });
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
    const opening = input.openingStock ? new Prisma.Decimal(input.openingStock) : null;
    const created = await tx.maintenanceItem.create({
      data: {
        name: input.name,
        sku: input.sku ?? null,
        unit: input.unit,
        category: input.category,
        minStock: input.minStock ? new Prisma.Decimal(input.minStock) : null,
        notes: input.notes ?? null,
        active: input.active ?? true,
        currentStock: opening && opening.gt(0) ? opening : new Prisma.Decimal(0),
      },
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
        },
      });
    }
    return created;
  });

  revalidatePath("/maintenance/items");
  revalidatePath("/maintenance/receipts");
  revalidatePath("/maintenance");
  return { id: row.id };
}

export async function deactivateMaintenanceItem(id: string) {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
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
}

export async function deleteMaintenanceItem(id: string) {
  const session = await requireRole(WRITE_ROLES);
  const [receiptLines, activityLines] = await Promise.all([
    db.maintenanceReceiptLine.count({ where: { itemId: id } }),
    db.maintenanceActivityLine.count({ where: { itemId: id } }),
  ]);
  if (receiptLines > 0 || activityLines > 0) {
    const bits: string[] = [];
    if (receiptLines > 0) bits.push(`${receiptLines} receipt line${receiptLines === 1 ? "" : "s"}`);
    if (activityLines > 0) bits.push(`${activityLines} activity line${activityLines === 1 ? "" : "s"}`);
    throw new Error(
      `This item has history (${bits.join(" + ")}). Deactivate instead to keep the audit trail.`
    );
  }
  await db.$transaction(async (tx) => {
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

export async function recordMaintenanceReceipt(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = MaintenanceReceiptInput.parse(raw);

  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    qty: new Prisma.Decimal(l.quantity),
    costPerUnit: l.costPerUnit ? new Prisma.Decimal(l.costPerUnit) : null,
  }));
  for (const l of lines) {
    if (l.qty.lessThanOrEqualTo(0)) throw new Error("Quantity must be > 0");
  }

  const receipt = await db.$transaction(async (tx) => {
    const created = await tx.maintenanceReceipt.create({
      data: {
        receivedAt: istToUtc(input.receivedAt),
        recordedById: session.user.id,
        sourceNote: input.sourceNote ?? null,
        sourceContact: input.sourceContact ?? null,
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
      },
    });
    return created;
  });

  revalidatePath("/maintenance/receipts");
  revalidatePath("/maintenance/items");
  revalidatePath("/maintenance");
  return { id: receipt.id };
}

export async function listMaintenanceReceipts(opts: { limit?: number } = {}) {
  await requireRole(READ_ROLES);
  return db.maintenanceReceipt.findMany({
    take: opts.limit ?? 100,
    orderBy: { receivedAt: "desc" },
    include: {
      recordedBy: { select: { id: true, name: true } },
      lines: { include: { item: { select: { id: true, name: true, unit: true, category: true } } } },
    },
  });
}

// ─── Activities (work performed at room) ──────────────────────────────

export async function recordMaintenanceActivity(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = MaintenanceActivityInput.parse(raw);

  const lines = (input.lines ?? []).map((l) => ({
    itemId: l.itemId,
    qty: new Prisma.Decimal(l.quantity),
  }));
  for (const l of lines) {
    if (l.qty.lessThanOrEqualTo(0)) throw new Error("Quantity must be > 0");
  }

  // Pre-check stock for any consumed items.
  if (lines.length > 0) {
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const items = await db.maintenanceItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, currentStock: true, unit: true, active: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const l of lines) {
      const it = byId.get(l.itemId);
      if (!it) throw new Error("Item not found");
      if (!it.active) throw new Error(`Item ${it.name} is inactive`);
      if (new Decimal(it.currentStock.toString()).lt(new Decimal(l.qty.toString()))) {
        throw new Error(
          `Not enough ${it.name} in stock (have ${it.currentStock.toString()} ${it.unit})`
        );
      }
    }
  }

  const activity = await db.$transaction(async (tx) => {
    const created = await tx.maintenanceActivity.create({
      data: {
        performedAt: istToUtc(input.performedAt),
        recordedById: session.user.id,
        staffId: input.staffId,
        roomId: input.roomId,
        category: input.category,
        status: input.status,
        issueReported: input.issueReported.trim(),
        workDone: input.workDone?.trim() || null,
        notes: input.notes?.trim() || null,
        lines: lines.length
          ? { create: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty })) }
          : undefined,
      },
    });
    for (const l of lines) {
      await tx.maintenanceItem.update({
        where: { id: l.itemId },
        data: { currentStock: { decrement: l.qty } },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MAINT_ACTIVITY_CREATED",
        entity: "MaintenanceActivity",
        entityId: created.id,
      },
    });
    return created;
  });

  revalidatePath("/maintenance/activities");
  revalidatePath("/maintenance/items");
  revalidatePath("/maintenance");
  return { id: activity.id };
}

export interface ListActivitiesOpts {
  from?: string;
  to?: string;
  roomId?: string;
  staffId?: string;
  itemId?: string;
  category?: MaintenanceCategory;
  status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  limit?: number;
}

export async function listMaintenanceActivities(opts: ListActivitiesOpts = {}) {
  await requireRole(READ_ROLES);
  const where: Prisma.MaintenanceActivityWhereInput = {};
  if (opts.from || opts.to) {
    where.performedAt = {};
    if (opts.from) (where.performedAt as Prisma.DateTimeFilter).gte = istToUtc(opts.from);
    if (opts.to) (where.performedAt as Prisma.DateTimeFilter).lte = istToUtc(opts.to);
  }
  if (opts.roomId) where.roomId = opts.roomId;
  if (opts.staffId) where.staffId = opts.staffId;
  if (opts.category) where.category = opts.category;
  if (opts.status) where.status = opts.status;
  if (opts.itemId) where.lines = { some: { itemId: opts.itemId } };

  return db.maintenanceActivity.findMany({
    where,
    take: opts.limit ?? 300,
    orderBy: { performedAt: "desc" },
    include: {
      recordedBy: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true, category: true } },
      room: { select: { id: true, number: true, name: true } },
      lines: { include: { item: { select: { id: true, name: true, unit: true, category: true } } } },
    },
  });
}

// ─── Reports ──────────────────────────────────────────────────────────

export type MaintenancePeriod = "WEEK" | "MONTH" | "QUARTER" | "CUSTOM";

function periodRange(p: MaintenancePeriod, from?: string, to?: string) {
  const now = new Date();
  if (p === "CUSTOM") {
    return {
      from: from ? istToUtc(from) : new Date(now.getFullYear(), 0, 1),
      to: to ? istToUtc(to) : now,
    };
  }
  const days = p === "WEEK" ? 7 : p === "MONTH" ? 30 : 90;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return { from: d, to: now };
}

/** Activity counts by category over the period. */
export async function activitiesByCategory(
  period: MaintenancePeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const { from, to } = periodRange(period, opts.from, opts.to);
  const grouped = await db.maintenanceActivity.groupBy({
    by: ["category"],
    where: { performedAt: { gte: from, lte: to } },
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
  const { from, to } = periodRange(period, opts.from, opts.to);
  const grouped = await db.maintenanceActivityLine.groupBy({
    by: ["itemId"],
    where: { activity: { performedAt: { gte: from, lte: to } } },
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
  const { from, to } = periodRange(period, opts.from, opts.to);
  const grouped = await db.maintenanceActivity.groupBy({
    by: ["roomId"],
    where: { performedAt: { gte: from, lte: to } },
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
  const { from, to } = periodRange(period, opts.from, opts.to);
  const grouped = await db.maintenanceActivity.groupBy({
    by: ["staffId"],
    where: { performedAt: { gte: from, lte: to } },
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];
  const staff = await db.maintenanceStaff.findMany({
    where: { id: { in: grouped.map((g) => g.staffId) } },
    select: { id: true, name: true, category: true },
  });
  const byId = new Map(staff.map((s) => [s.id, s]));
  return grouped
    .map((g) => ({
      staffId: g.staffId,
      staffName: byId.get(g.staffId)?.name ?? "—",
      category: byId.get(g.staffId)?.category ?? "GENERAL",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Top-line counters for the maintenance dashboard. */
export async function maintenanceSummary() {
  await requireRole(READ_ROLES);
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [itemCount, lowStock, recentReceipts, recentActivities, pending] =
    await Promise.all([
      db.maintenanceItem.count({ where: { active: true } }),
      db.maintenanceItem.findMany({
        where: { active: true, minStock: { not: null } },
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
      db.maintenanceActivity.count({ where: { performedAt: { gte: oneWeekAgo } } }),
      db.maintenanceActivity.count({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      }),
    ]);

  const lows = lowStock
    .filter((i) => {
      if (!i.minStock) return false;
      return new Decimal(i.currentStock.toString()).lte(
        new Decimal(i.minStock.toString())
      );
    })
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      category: i.category,
      currentStock: i.currentStock.toString(),
      minStock: i.minStock!.toString(),
    }));

  const topConsumed = await maintenanceConsumptionByItem("WEEK");
  const byCat = await activitiesByCategory("WEEK");

  return {
    itemCount,
    lowStock: lows,
    receiptsLastWeek: recentReceipts,
    activitiesLastWeek: recentActivities,
    pendingActivities: pending,
    topItemsThisWeek: topConsumed.slice(0, 5),
    byCategoryThisWeek: byCat,
  };
}
