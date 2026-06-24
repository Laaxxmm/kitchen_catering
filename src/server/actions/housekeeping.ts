"use server";

import { revalidatePath } from "next/cache";
import { Prisma, Role } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { requireRole, requireSession } from "@/server/rbac";
import { istToUtc } from "@/lib/time";
import {
  HousekeepingItemInput,
  HousekeepingIssueInput,
  HousekeepingReceiptInput,
  HousekeepingStaffInput,
  RoomInput,
} from "@/lib/validators";

// Housekeeping is a self-contained stockroom for hotel guest supplies.
// Distinct from kitchen inventory — runs on its own catalog (HousekeepingItem),
// its own receipts (from maintenance) and its own issues (to room via staff).
//
// Who can do what:
//   HOUSEKEEPING_MANAGER: full read+write on housekeeping items, rooms,
//                        staff, receipts, issues. Cannot see other modules
//                        unless granted via role-nav.
//   ADMIN/MANAGER:       full read+write (oversight + reports).

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER];
const READ_ROLES = [
  Role.ADMIN,
  Role.MANAGER,
  Role.HOUSEKEEPING_MANAGER,
];

// ─── Rooms ────────────────────────────────────────────────────────────

export async function upsertRoom(raw: unknown, id?: string) {
  const session = await requireRole(WRITE_ROLES);
  const input = RoomInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    if (id) {
      const updated = await tx.room.update({
        where: { id },
        data: {
          number: input.number,
          name: input.name ?? null,
          type: input.type,
          floor: input.floor ?? null,
          active: input.active ?? true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ROOM_UPDATED",
          entity: "Room",
          entityId: updated.id,
        },
      });
      return updated;
    }
    const created = await tx.room.create({
      data: {
        number: input.number,
        name: input.name ?? null,
        type: input.type,
        floor: input.floor ?? null,
        active: input.active ?? true,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ROOM_CREATED",
        entity: "Room",
        entityId: created.id,
      },
    });
    return created;
  });

  revalidatePath("/housekeeping/rooms");
  return { id: row.id };
}

export async function deactivateRoom(id: string) {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    await tx.room.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ROOM_DEACTIVATED",
        entity: "Room",
        entityId: id,
      },
    });
  });
  revalidatePath("/housekeeping/rooms");
}

/**
 * HARD delete a room. Refuses if it has any issues attached (deleting
 * would destroy historical records). Caller should fall back to
 * `deactivateRoom` in that case.
 */
export async function deleteRoom(id: string) {
  const session = await requireRole(WRITE_ROLES);
  const issues = await db.housekeepingIssue.count({ where: { roomId: id } });
  if (issues > 0) {
    throw new Error(
      `This room has ${issues} historical issue${issues === 1 ? "" : "s"}. Deactivate instead to keep the audit trail.`
    );
  }
  await db.$transaction(async (tx) => {
    await tx.room.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ROOM_DELETED",
        entity: "Room",
        entityId: id,
      },
    });
  });
  revalidatePath("/housekeeping/rooms");
}

export async function listRooms(opts: { activeOnly?: boolean } = {}) {
  // Rooms are a shared master — also read by maintenance when logging
  // activities. Per-module write access stays scoped (see upsertRoom).
  await requireRole([...READ_ROLES, Role.MAINTENANCE_MANAGER]);
  return db.room.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { number: "asc" }],
  });
}

// ─── Housekeeping staff ───────────────────────────────────────────────

export async function upsertHousekeepingStaff(raw: unknown, id?: string) {
  const session = await requireRole(WRITE_ROLES);
  const input = HousekeepingStaffInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    if (id) {
      const updated = await tx.housekeepingStaff.update({
        where: { id },
        data: {
          name: input.name,
          phone: input.phone ?? null,
          notes: input.notes ?? null,
          active: input.active ?? true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "HK_STAFF_UPDATED",
          entity: "HousekeepingStaff",
          entityId: updated.id,
        },
      });
      return updated;
    }
    const created = await tx.housekeepingStaff.create({
      data: {
        name: input.name,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        active: input.active ?? true,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "HK_STAFF_CREATED",
        entity: "HousekeepingStaff",
        entityId: created.id,
      },
    });
    return created;
  });

  revalidatePath("/housekeeping/staff");
  return { id: row.id };
}

export async function deactivateHousekeepingStaff(id: string) {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    await tx.housekeepingStaff.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "HK_STAFF_DEACTIVATED",
        entity: "HousekeepingStaff",
        entityId: id,
      },
    });
  });
  revalidatePath("/housekeeping/staff");
}

export async function deleteHousekeepingStaff(id: string) {
  const session = await requireRole(WRITE_ROLES);
  const issues = await db.housekeepingIssue.count({ where: { staffId: id } });
  if (issues > 0) {
    throw new Error(
      `This staff member has ${issues} historical issue${issues === 1 ? "" : "s"}. Deactivate instead to keep the audit trail.`
    );
  }
  await db.$transaction(async (tx) => {
    await tx.housekeepingStaff.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "HK_STAFF_DELETED",
        entity: "HousekeepingStaff",
        entityId: id,
      },
    });
  });
  revalidatePath("/housekeeping/staff");
}

export async function listHousekeepingStaff(opts: { activeOnly?: boolean } = {}) {
  await requireRole(READ_ROLES);
  return db.housekeepingStaff.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

// ─── Items ────────────────────────────────────────────────────────────

export async function upsertHousekeepingItem(raw: unknown, id?: string) {
  const session = await requireRole(WRITE_ROLES);
  const input = HousekeepingItemInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    if (id) {
      const updated = await tx.housekeepingItem.update({
        where: { id },
        data: {
          name: input.name,
          sku: input.sku ?? null,
          unit: input.unit,
          reusable: input.reusable ?? false,
          minStock: input.minStock ? new Prisma.Decimal(input.minStock) : null,
          notes: input.notes ?? null,
          active: input.active ?? true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "HK_ITEM_UPDATED",
          entity: "HousekeepingItem",
          entityId: updated.id,
        },
      });
      return updated;
    }
    const opening = input.openingStock ? new Prisma.Decimal(input.openingStock) : null;
    const created = await tx.housekeepingItem.create({
      data: {
        name: input.name,
        sku: input.sku ?? null,
        unit: input.unit,
        reusable: input.reusable ?? false,
        minStock: input.minStock ? new Prisma.Decimal(input.minStock) : null,
        notes: input.notes ?? null,
        active: input.active ?? true,
        currentStock: opening && opening.gt(0) ? opening : new Prisma.Decimal(0),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "HK_ITEM_CREATED",
        entity: "HousekeepingItem",
        entityId: created.id,
      },
    });
    // If an opening balance was provided, materialise an internal receipt
    // row so the stock movement has an audit trail (otherwise the running
    // ledger would show a phantom starting balance).
    if (opening && opening.gt(0)) {
      const receipt = await tx.housekeepingReceipt.create({
        data: {
          receivedAt: new Date(),
          recordedById: session.user.id,
          sourceNote: "Opening balance (set during item creation)",
          sourceContact: "Opening balance",
          lines: {
            create: [{ itemId: created.id, quantity: opening }],
          },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "HK_OPENING_BALANCE_SET",
          entity: "HousekeepingReceipt",
          entityId: receipt.id,
        },
      });
    }
    return created;
  });

  revalidatePath("/housekeeping/items");
  revalidatePath("/housekeeping/receipts");
  revalidatePath("/housekeeping");
  return { id: row.id };
}

export async function deactivateHousekeepingItem(id: string) {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    await tx.housekeepingItem.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "HK_ITEM_DEACTIVATED",
        entity: "HousekeepingItem",
        entityId: id,
      },
    });
  });
  revalidatePath("/housekeeping/items");
}

/**
 * HARD delete a housekeeping item. Refuses if it has any receipt or
 * issue lines (deleting would orphan history). The caller is responsible
 * for falling back to `deactivateHousekeepingItem` when this throws.
 */
export async function deleteHousekeepingItem(id: string) {
  const session = await requireRole(WRITE_ROLES);
  const [receiptLines, issueLines] = await Promise.all([
    db.housekeepingReceiptLine.count({ where: { itemId: id } }),
    db.housekeepingIssueLine.count({ where: { itemId: id } }),
  ]);
  if (receiptLines > 0 || issueLines > 0) {
    const bits: string[] = [];
    if (receiptLines > 0) bits.push(`${receiptLines} receipt line${receiptLines === 1 ? "" : "s"}`);
    if (issueLines > 0) bits.push(`${issueLines} issue line${issueLines === 1 ? "" : "s"}`);
    throw new Error(
      `This item has history (${bits.join(" + ")}). Deactivate instead to keep the audit trail.`
    );
  }
  await db.$transaction(async (tx) => {
    await tx.housekeepingItem.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "HK_ITEM_DELETED",
        entity: "HousekeepingItem",
        entityId: id,
      },
    });
  });
  revalidatePath("/housekeeping/items");
  revalidatePath("/housekeeping");
}

export async function listHousekeepingItems(opts: { activeOnly?: boolean } = {}) {
  await requireRole(READ_ROLES);
  return db.housekeepingItem.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

// ─── Receipts (maintenance → housekeeping) ────────────────────────────

export async function recordHousekeepingReceipt(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = HousekeepingReceiptInput.parse(raw);

  // Coerce + validate quantities once before opening the txn.
  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    qty: new Prisma.Decimal(l.quantity),
    costPerUnit: l.costPerUnit ? new Prisma.Decimal(l.costPerUnit) : null,
  }));
  for (const l of lines) {
    if (l.qty.lessThanOrEqualTo(0)) throw new Error("Quantity must be > 0");
  }

  const receipt = await db.$transaction(async (tx) => {
    const created = await tx.housekeepingReceipt.create({
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
    // Bump currentStock on each item.
    for (const l of lines) {
      await tx.housekeepingItem.update({
        where: { id: l.itemId },
        data: { currentStock: { increment: l.qty } },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "HK_RECEIPT_CREATED",
        entity: "HousekeepingReceipt",
        entityId: created.id,
      },
    });
    return created;
  });

  revalidatePath("/housekeeping/receipts");
  revalidatePath("/housekeeping/items");
  revalidatePath("/housekeeping");
  return { id: receipt.id };
}

export async function listHousekeepingReceipts(opts: { limit?: number } = {}) {
  await requireRole(READ_ROLES);
  return db.housekeepingReceipt.findMany({
    take: opts.limit ?? 100,
    orderBy: { receivedAt: "desc" },
    include: {
      recordedBy: { select: { id: true, name: true } },
      lines: {
        include: { item: { select: { id: true, name: true, unit: true } } },
      },
    },
  });
}

// ─── Issues (housekeeping → room via staff) ───────────────────────────

export async function recordHousekeepingIssue(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = HousekeepingIssueInput.parse(raw);

  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    qty: new Prisma.Decimal(l.quantity),
  }));
  for (const l of lines) {
    if (l.qty.lessThanOrEqualTo(0)) throw new Error("Quantity must be > 0");
  }

  // Pre-check stock availability — fail fast with a friendly message.
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const items = await db.housekeepingItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, currentStock: true, unit: true, active: true, reusable: true },
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

  const issue = await db.$transaction(async (tx) => {
    const created = await tx.housekeepingIssue.create({
      data: {
        issuedAt: istToUtc(input.issuedAt),
        recordedById: session.user.id,
        staffId: input.staffId,
        roomId: input.roomId,
        purpose: input.purpose ?? null,
        notes: input.notes ?? null,
        lines: {
          create: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty })),
        },
      },
    });
    for (const l of lines) {
      // Reusable items move from clean stock into circulation (they'll come
      // back via a Return). Consumables just leave stock.
      const reusable = byId.get(l.itemId)?.reusable ?? false;
      await tx.housekeepingItem.update({
        where: { id: l.itemId },
        data: {
          currentStock: { decrement: l.qty },
          ...(reusable ? { inCirculation: { increment: l.qty } } : {}),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "HK_ISSUE_CREATED",
        entity: "HousekeepingIssue",
        entityId: created.id,
      },
    });
    return created;
  });

  revalidatePath("/housekeeping/issues");
  revalidatePath("/housekeeping/items");
  revalidatePath("/housekeeping");
  return { id: issue.id };
}

/** Reusable items that have units out in circulation — powers the Return picker. */
export async function listReusableInCirculation() {
  await requireRole(WRITE_ROLES);
  const rows = await db.housekeepingItem.findMany({
    where: { active: true, reusable: true },
    select: { id: true, name: true, unit: true, currentStock: true, inCirculation: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    currentStock: r.currentStock.toString(),
    inCirculation: r.inCirculation.toString(),
  }));
}

/**
 * Close the reusable loop. "returned" (washed & back) moves units from
 * circulation back into clean stock; "lost" (damaged / not coming back)
 * removes them from circulation without restocking. You can't return more
 * than is currently out.
 */
export async function returnHousekeepingStock(input: {
  itemId: string;
  qty: string;
  outcome: "returned" | "lost";
  note?: string;
}) {
  const session = await requireRole(WRITE_ROLES);
  const qty = new Prisma.Decimal(input.qty || "0");
  if (qty.lessThanOrEqualTo(0)) throw new Error("Quantity must be greater than 0");

  await db.$transaction(async (tx) => {
    const item = await tx.housekeepingItem.findUnique({
      where: { id: input.itemId },
      select: { id: true, name: true, unit: true, reusable: true, inCirculation: true },
    });
    if (!item) throw new Error("Item not found");
    if (!item.reusable) throw new Error(`${item.name} isn't a reusable item`);
    const circ = new Decimal(item.inCirculation.toString());
    if (new Decimal(qty.toString()).gt(circ)) {
      throw new Error(`Only ${circ.toString()} ${item.unit} of ${item.name} are out in use — can't return ${qty.toString()}.`);
    }

    await tx.housekeepingItem.update({
      where: { id: item.id },
      data: {
        inCirculation: { decrement: qty },
        ...(input.outcome === "returned" ? { currentStock: { increment: qty } } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: input.outcome === "returned" ? "HK_REUSABLE_RETURNED" : "HK_REUSABLE_WRITTEN_OFF",
        entity: "HousekeepingItem",
        entityId: item.id,
      },
    });
  });

  revalidatePath("/housekeeping/items");
  revalidatePath("/housekeeping");
}

export interface ListIssuesOpts {
  from?: string;
  to?: string;
  roomId?: string;
  staffId?: string;
  itemId?: string;
  limit?: number;
}

export async function listHousekeepingIssues(opts: ListIssuesOpts = {}) {
  await requireRole(READ_ROLES);
  const where: Prisma.HousekeepingIssueWhereInput = {};
  if (opts.from || opts.to) {
    where.issuedAt = {};
    if (opts.from) (where.issuedAt as Prisma.DateTimeFilter).gte = istToUtc(opts.from);
    if (opts.to) (where.issuedAt as Prisma.DateTimeFilter).lte = istToUtc(opts.to);
  }
  if (opts.roomId) where.roomId = opts.roomId;
  if (opts.staffId) where.staffId = opts.staffId;
  if (opts.itemId) where.lines = { some: { itemId: opts.itemId } };

  return db.housekeepingIssue.findMany({
    where,
    take: opts.limit ?? 200,
    orderBy: { issuedAt: "desc" },
    include: {
      recordedBy: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true } },
      room: { select: { id: true, number: true, name: true } },
      lines: {
        include: { item: { select: { id: true, name: true, unit: true } } },
      },
    },
  });
}

// ─── Reports ──────────────────────────────────────────────────────────

export type ReportPeriod = "WEEK" | "MONTH" | "QUARTER" | "CUSTOM";

function periodRange(p: ReportPeriod, from?: string, to?: string) {
  const now = new Date();
  if (p === "CUSTOM") {
    return {
      from: from ? istToUtc(from) : new Date(now.getFullYear(), 0, 1),
      to: to ? istToUtc(to) : now,
    };
  }
  if (p === "WEEK") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return { from: d, to: now };
  }
  if (p === "MONTH") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return { from: d, to: now };
  }
  // QUARTER
  const d = new Date(now);
  d.setDate(d.getDate() - 90);
  return { from: d, to: now };
}

/**
 * Aggregated consumption — by item — over the given period.
 * Used for the admin "consumed this week / month / quarter" view.
 */
export async function consumptionByItem(
  period: ReportPeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const { from, to } = periodRange(period, opts.from, opts.to);

  const grouped = await db.housekeepingIssueLine.groupBy({
    by: ["itemId"],
    where: { issue: { issuedAt: { gte: from, lte: to } } },
    _sum: { quantity: true },
  });
  const items = await db.housekeepingItem.findMany({
    where: { id: { in: grouped.map((g) => g.itemId) } },
    select: { id: true, name: true, unit: true, currentStock: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  return grouped
    .map((g) => ({
      itemId: g.itemId,
      name: byId.get(g.itemId)?.name ?? "—",
      unit: byId.get(g.itemId)?.unit ?? "",
      currentStock: byId.get(g.itemId)?.currentStock.toString() ?? "0",
      consumed: g._sum.quantity?.toString() ?? "0",
    }))
    .sort((a, b) => Number(b.consumed) - Number(a.consumed));
}

/**
 * Aggregated consumption — by room — over the given period.
 * (Total quantity across all items.)
 */
export async function consumptionByRoom(
  period: ReportPeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const { from, to } = periodRange(period, opts.from, opts.to);

  // Postgres-side: sum line quantities grouped by room.
  const rows = await db.$queryRaw<
    Array<{ roomId: string; total: string }>
  >`
    SELECT i."roomId", COALESCE(SUM(l."quantity"), 0)::text AS total
    FROM "HousekeepingIssueLine" l
    JOIN "HousekeepingIssue" i ON i."id" = l."issueId"
    WHERE i."issuedAt" >= ${from} AND i."issuedAt" <= ${to}
    GROUP BY i."roomId"
    ORDER BY SUM(l."quantity") DESC
  `;
  if (rows.length === 0) return [];
  const rooms = await db.room.findMany({
    where: { id: { in: rows.map((r) => r.roomId) } },
    select: { id: true, number: true, name: true },
  });
  const byId = new Map(rooms.map((r) => [r.id, r]));
  return rows.map((r) => ({
    roomId: r.roomId,
    roomNumber: byId.get(r.roomId)?.number ?? "—",
    roomName: byId.get(r.roomId)?.name ?? null,
    totalUnits: r.total,
  }));
}

/**
 * Aggregated consumption — by staff — over the given period.
 */
export async function consumptionByStaff(
  period: ReportPeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const { from, to } = periodRange(period, opts.from, opts.to);
  const rows = await db.$queryRaw<
    Array<{ staffId: string; total: string; trips: bigint }>
  >`
    SELECT i."staffId", COALESCE(SUM(l."quantity"), 0)::text AS total,
           COUNT(DISTINCT i."id") AS trips
    FROM "HousekeepingIssueLine" l
    JOIN "HousekeepingIssue" i ON i."id" = l."issueId"
    WHERE i."issuedAt" >= ${from} AND i."issuedAt" <= ${to}
    GROUP BY i."staffId"
    ORDER BY SUM(l."quantity") DESC
  `;
  if (rows.length === 0) return [];
  const staff = await db.housekeepingStaff.findMany({
    where: { id: { in: rows.map((r) => r.staffId) } },
    select: { id: true, name: true },
  });
  const byId = new Map(staff.map((s) => [s.id, s]));
  return rows.map((r) => ({
    staffId: r.staffId,
    staffName: byId.get(r.staffId)?.name ?? "—",
    totalUnits: r.total,
    trips: Number(r.trips),
  }));
}

/** Top-line counters for the housekeeping dashboard. */
export async function housekeepingSummary() {
  await requireRole(READ_ROLES);
  const [items, lowStock, recentReceipts, recentIssues] = await Promise.all([
    db.housekeepingItem.count({ where: { active: true } }),
    db.housekeepingItem.findMany({
      where: {
        active: true,
        minStock: { not: null },
      },
      select: {
        id: true,
        name: true,
        unit: true,
        currentStock: true,
        minStock: true,
      },
    }),
    db.housekeepingReceipt.count({
      where: { receivedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
    }),
    db.housekeepingIssue.count({
      where: { issuedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
    }),
  ]);
  // Filter low-stock client-side because we need to compare Decimal fields.
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
      currentStock: i.currentStock.toString(),
      minStock: i.minStock!.toString(),
    }));

  // This-week consumption value (sum of issue line quantities — value isn't
  // tracked unless costPerUnit was set on receipts; total units is the v1
  // KPI). Top-3 consumed items.
  const top = await consumptionByItem("WEEK");

  return {
    itemCount: items,
    lowStock: lows,
    receiptsLastWeek: recentReceipts,
    issuesLastWeek: recentIssues,
    topItemsThisWeek: top.slice(0, 5),
  };
}

/** Authoritative server-side check that the user can write — used by
 *  client components to decide whether to render an "Add" button. */
export async function canWriteHousekeeping() {
  const session = await requireSession();
  return (WRITE_ROLES as Role[]).includes(session.user.role);
}
