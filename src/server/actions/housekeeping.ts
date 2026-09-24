"use server";

import { revalidatePath } from "next/cache";
import { Prisma, Role, StockStore, StoreAdjustmentKind } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole, requireSession } from "@/server/rbac";
import { formatIST, istDayWindow, istToUtc } from "@/lib/time";
import { sha256Json } from "@/lib/audit";
import { deferAfterResponse } from "@/server/defer";
import { notifyRoles } from "@/server/notification-core";
import {
  HousekeepingItemInput,
  HousekeepingIssueInput,
  HousekeepingReceiptInput,
  HousekeepingReturnInput,
  HousekeepingStaffInput,
  RoomInput,
} from "@/lib/validators";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

type Tx = Prisma.TransactionClient;
type Session = Awaited<ReturnType<typeof requireRole>>;

/**
 * Row-lock housekeeping items for the rest of the transaction. Every stock
 * movement (receipt / issue / return) reads or updates currentStock /
 * inCirculation — without the lock two concurrent movements read the same
 * snapshot and one update is silently lost (stock can even go negative past
 * the availability check). FOR UPDATE serialises them; ids are locked in a
 * stable order so concurrent multi-line movements can't deadlock.
 */
async function lockHousekeepingItemRows(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$executeRaw`SELECT 1 FROM "HousekeepingItem" WHERE "id" = ${id} FOR UPDATE`;
  }
}

/** Quantities live at 3 dp. Anything that rounds to nothing is refused
 *  rather than written as a 0-quantity line. */
function toQty(raw: string, what: string): Prisma.Decimal {
  const q = new Prisma.Decimal(raw).toDecimalPlaces(3);
  if (q.lte(0)) throw new ActionError(`${what}: quantity must be at least 0.001`);
  return q;
}

/** "YYYY-MM-DD" (an IST calendar day) → UTC start of that day. Anything
 *  else — blank, malformed, 31 Feb — is ignored rather than crashing the
 *  page. */
function dayStart(s?: string): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  try {
    const d = istToUtc(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  } catch {
    return undefined;
  }
}

/** The moment the "to" day ends — half-open, so the whole day is included. */
function dayEnd(s?: string): Date | undefined {
  const d = dayStart(s);
  return d ? istDayWindow(d).toExclusive : undefined;
}

function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const gte = dayStart(from);
  const lt = dayEnd(to);
  if (!gte && !lt) return undefined;
  return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}

/** A receipt or issue keyed in by admin / manager is news to the desk that
 *  owns the stock. The desk's own postings need no echo. */
function tellHousekeepingManager(
  session: Session,
  label: string,
  n: { title: string; body: string; link: string; dedupeKey: string },
) {
  if (session.user.role === Role.HOUSEKEEPING_MANAGER) return;
  deferAfterResponse(label, () =>
    notifyRoles([Role.HOUSEKEEPING_MANAGER], { kind: "GENERIC", ...n }),
  );
}

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

export async function upsertRoom(
  raw: unknown,
  id?: string,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await upsertRoomInner(raw, id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function upsertRoomInner(raw: unknown, id?: string): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = RoomInput.parse(raw);
  const number = input.number.trim();
  if (!number) throw new ActionError("Room number is required");

  const row = await db.$transaction(async (tx) => {
    const dupe = await tx.room.findFirst({
      where: {
        number: { equals: number, mode: "insensitive" },
        ...(id ? { id: { not: id } } : {}),
      },
      select: { number: true },
    });
    if (dupe) throw new ActionError(`Room "${dupe.number}" already exists.`);

    const data = {
      number,
      name: input.name ?? null,
      type: input.type,
      floor: input.floor ?? null,
      active: input.active ?? true,
    };
    if (id) {
      const updated = await tx.room.update({ where: { id }, data });
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
    const created = await tx.room.create({ data });
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
  return { ok: true, id: row.id };
}

export async function deactivateRoom(id: string): Promise<ActionResult> {
  try {
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
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * HARD delete a room. Refuses if it has any issues attached (deleting
 * would destroy historical records). Caller should fall back to
 * `deactivateRoom` in that case.
 */
export async function deleteRoom(id: string): Promise<ActionResult> {
  try {
    return await deleteRoomInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function deleteRoomInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const issues = await db.housekeepingIssue.count({ where: { roomId: id } });
  if (issues > 0) {
    throw new ActionError(
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
  return { ok: true };
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

export async function upsertHousekeepingStaff(
  raw: unknown,
  id?: string,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await upsertHousekeepingStaffInner(raw, id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function upsertHousekeepingStaffInner(
  raw: unknown,
  id?: string,
): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = HousekeepingStaffInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    const dupe = await tx.housekeepingStaff.findFirst({
      where: {
        name: { equals: input.name, mode: "insensitive" },
        ...(id ? { id: { not: id } } : {}),
      },
      select: { name: true },
    });
    if (dupe) throw new ActionError(`A staff member named "${dupe.name}" already exists.`);

    const data = {
      name: input.name,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
      active: input.active ?? true,
    };
    if (id) {
      const updated = await tx.housekeepingStaff.update({ where: { id }, data });
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
    const created = await tx.housekeepingStaff.create({ data });
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
  return { ok: true, id: row.id };
}

export async function deactivateHousekeepingStaff(id: string): Promise<ActionResult> {
  try {
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
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function deleteHousekeepingStaff(id: string): Promise<ActionResult> {
  try {
    return await deleteHousekeepingStaffInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function deleteHousekeepingStaffInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const issues = await db.housekeepingIssue.count({ where: { staffId: id } });
  if (issues > 0) {
    throw new ActionError(
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
  return { ok: true };
}

export async function listHousekeepingStaff(opts: { activeOnly?: boolean } = {}) {
  await requireRole(READ_ROLES);
  return db.housekeepingStaff.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

// ─── Items ────────────────────────────────────────────────────────────

export async function upsertHousekeepingItem(
  raw: unknown,
  id?: string,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await upsertHousekeepingItemInner(raw, id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function upsertHousekeepingItemInner(
  raw: unknown,
  id?: string,
): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = HousekeepingItemInput.parse(raw);
  const minStock = input.minStock ? new Prisma.Decimal(input.minStock).toDecimalPlaces(3) : null;

  const row = await db.$transaction(async (tx) => {
    const dupe = await tx.housekeepingItem.findFirst({
      where: {
        name: { equals: input.name, mode: "insensitive" },
        ...(id ? { id: { not: id } } : {}),
      },
      select: { name: true, active: true },
    });
    if (dupe) {
      throw new ActionError(
        dupe.active
          ? `An item named "${dupe.name}" already exists.`
          : `An inactive item named "${dupe.name}" already exists — reactivate it instead of adding a new one.`,
      );
    }

    if (id) {
      await lockHousekeepingItemRows(tx, [id]);
      const cur = await tx.housekeepingItem.findUnique({
        where: { id },
        select: { name: true, unit: true, reusable: true, currentStock: true, inCirculation: true },
      });
      if (!cur) throw new ActionError("Item not found");
      // The unit is what every stored quantity is measured in. Once there
      // is stock or history in "piece", relabelling it "kg" rewrites the
      // meaning of every past line.
      if (input.unit !== cur.unit) {
        let hasHistory = cur.currentStock.gt(0) || cur.inCirculation.gt(0);
        if (!hasHistory) {
          hasHistory =
            (await tx.housekeepingReceiptLine.count({ where: { itemId: id } })) > 0 ||
            (await tx.housekeepingIssueLine.count({ where: { itemId: id } })) > 0;
        }
        if (hasHistory) {
          throw new ActionError(
            `Can't change the unit of ${cur.name} from ${cur.unit} to ${input.unit} — it already has stock or movements in ${cur.unit}. Add a new item instead.`,
          );
        }
      }
      if (cur.reusable && input.reusable === false && cur.inCirculation.gt(0)) {
        throw new ActionError(
          `${cur.name} still has ${cur.inCirculation.toString()} ${cur.unit} out in rooms — return them before making it a consumable.`,
        );
      }
      const updated = await tx.housekeepingItem.update({
        where: { id },
        data: {
          name: input.name,
          sku: input.sku ?? null,
          unit: input.unit,
          // undefined = leave alone: the edit form doesn't carry every field,
          // and a field it doesn't send must not be wiped.
          reusable: input.reusable,
          minStock,
          notes: input.notes,
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

    // "0" / blank = no opening balance; anything else must be a real quantity.
    const opening =
      input.openingStock && new Prisma.Decimal(input.openingStock).gt(0)
        ? toQty(input.openingStock, "Opening stock")
        : null;
    const created = await tx.housekeepingItem.create({
      data: {
        name: input.name,
        sku: input.sku ?? null,
        unit: input.unit,
        reusable: input.reusable ?? false,
        minStock,
        notes: input.notes ?? null,
        active: input.active ?? true,
        currentStock: opening ?? new Prisma.Decimal(0),
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
    if (opening) {
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
          payloadHash: sha256Json({ itemId: created.id, qty: opening.toString() }),
        },
      });
    }
    return created;
  });

  revalidatePath("/housekeeping/items");
  revalidatePath("/housekeeping/receipts");
  revalidatePath("/housekeeping");
  return { ok: true, id: row.id };
}

export async function deactivateHousekeepingItem(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    await db.$transaction(async (tx) => {
      await lockHousekeepingItemRows(tx, [id]);
      const item = await tx.housekeepingItem.findUnique({
        where: { id },
        select: { name: true, unit: true, currentStock: true, inCirculation: true },
      });
      if (!item) throw new ActionError("Item not found");
      if (item.currentStock.gt(0) || item.inCirculation.gt(0)) {
        throw new ActionError(
          `${item.name} still has ${item.currentStock.toString()} ${item.unit} in stock and ${item.inCirculation.toString()} out in rooms — bring both to zero before deactivating.`,
        );
      }
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
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * HARD delete a housekeeping item. Refuses if it has any receipt or
 * issue lines (deleting would orphan history). The caller is responsible
 * for falling back to `deactivateHousekeepingItem` when this throws.
 */
export async function deleteHousekeepingItem(id: string): Promise<ActionResult> {
  try {
    return await deleteHousekeepingItemInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function deleteHousekeepingItemInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    // Counted under the row lock so a receipt landing mid-check can't slip
    // through. Store transfers count as history too: they carry no FK (the
    // item ids are polymorphic across three catalogues), so nothing but
    // this check stops a moved-stock document losing the item it names.
    await lockHousekeepingItemRows(tx, [id]);
    const item = await tx.housekeepingItem.findUnique({
      where: { id },
      select: { name: true, unit: true, currentStock: true, inCirculation: true },
    });
    if (!item) throw new ActionError("Item not found");
    if (item.currentStock.gt(0) || item.inCirculation.gt(0)) {
      throw new ActionError(
        `${item.name} still has ${item.currentStock.toString()} ${item.unit} in stock and ${item.inCirculation.toString()} out in rooms — bring both to zero first.`,
      );
    }
    const receiptLines = await tx.housekeepingReceiptLine.count({ where: { itemId: id } });
    const issueLines = await tx.housekeepingIssueLine.count({ where: { itemId: id } });
    const adjustments = await tx.housekeepingAdjustment.count({ where: { itemId: id } });
    const transfers = await tx.stockTransfer.count({
      where: {
        OR: [
          { fromStore: StockStore.HOUSEKEEPING, fromItemId: id },
          { toStore: StockStore.HOUSEKEEPING, toItemId: id },
        ],
      },
    });
    if (receiptLines > 0 || issueLines > 0 || adjustments > 0 || transfers > 0) {
      const bits: string[] = [];
      if (receiptLines > 0) bits.push(`${receiptLines} receipt line${receiptLines === 1 ? "" : "s"}`);
      if (issueLines > 0) bits.push(`${issueLines} issue line${issueLines === 1 ? "" : "s"}`);
      if (adjustments > 0) bits.push(`${adjustments} adjustment${adjustments === 1 ? "" : "s"}`);
      if (transfers > 0) bits.push(`${transfers} store transfer${transfers === 1 ? "" : "s"}`);
      throw new ActionError(
        `This item has history (${bits.join(" + ")}). Deactivate instead to keep the audit trail.`
      );
    }
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
  return { ok: true };
}

export async function listHousekeepingItems(opts: { activeOnly?: boolean } = {}) {
  await requireRole(READ_ROLES);
  return db.housekeepingItem.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

// ─── Receipts (maintenance → housekeeping) ────────────────────────────

export async function recordHousekeepingReceipt(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordHousekeepingReceiptInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordHousekeepingReceiptInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = HousekeepingReceiptInput.parse(raw);

  // Coerce + validate quantities once before opening the txn.
  const lines = input.lines.map((l, i) => ({
    itemId: l.itemId,
    qty: toQty(l.quantity, `Line ${i + 1}`),
    costPerUnit: l.costPerUnit ? new Prisma.Decimal(l.costPerUnit) : null,
  }));
  const itemIds = [...new Set(lines.map((l) => l.itemId))];

  const receipt = await db.$transaction(async (tx) => {
    await lockHousekeepingItemRows(tx, itemIds);
    const items = await tx.housekeepingItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, active: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of itemIds) {
      const it = byId.get(id);
      if (!it) throw new ActionError("Item not found — refresh the page and pick it again");
      if (!it.active) throw new ActionError(`${it.name} is inactive — reactivate it before receiving stock`);
    }

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
        payloadHash: sha256Json({
          receivedAt: input.receivedAt,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            qty: l.qty.toString(),
            costPerUnit: l.costPerUnit?.toString() ?? null,
          })),
        }),
      },
    });
    return { id: created.id, names: items.map((i) => i.name) };
  });

  tellHousekeepingManager(session, "housekeeping:receipt:notify", {
    title: "Housekeeping receipt recorded",
    body: `${receipt.names.join(", ")} — by ${session.user.name ?? session.user.email}`,
    link: "/housekeeping/receipts",
    dedupeKey: `hk-receipt:${receipt.id}`,
  });

  revalidatePath("/housekeeping/receipts");
  revalidatePath("/housekeeping/items");
  revalidatePath("/housekeeping");
  return { ok: true, id: receipt.id };
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

export async function recordHousekeepingIssue(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordHousekeepingIssueInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordHousekeepingIssueInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = HousekeepingIssueInput.parse(raw);

  const lines = input.lines.map((l, i) => ({
    itemId: l.itemId,
    qty: toQty(l.quantity, `Line ${i + 1}`),
  }));
  // Availability is checked per ITEM, not per line: two lines for the same
  // towel must not each pass against the same snapshot and overdraw together.
  const totals = new Map<string, Prisma.Decimal>();
  for (const l of lines) {
    totals.set(l.itemId, (totals.get(l.itemId) ?? new Prisma.Decimal(0)).plus(l.qty));
  }
  const itemIds = [...totals.keys()];

  const issue = await db.$transaction(async (tx) => {
    // Check stock availability under the row lock — a pre-check outside the
    // txn could pass for two concurrent issues that together overdraw.
    await lockHousekeepingItemRows(tx, itemIds);
    const staff = await tx.housekeepingStaff.findUnique({
      where: { id: input.staffId },
      select: { active: true },
    });
    if (!staff?.active) throw new ActionError("Pick an active staff member");
    const room = await tx.room.findUnique({ where: { id: input.roomId }, select: { active: true } });
    if (!room?.active) throw new ActionError("Pick an active room");

    const items = await tx.housekeepingItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        name: true,
        currentStock: true,
        minStock: true,
        unit: true,
        active: true,
        reusable: true,
      },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const [itemId, total] of totals) {
      const it = byId.get(itemId);
      if (!it) throw new ActionError("Item not found — refresh the page and pick it again");
      if (!it.active) throw new ActionError(`${it.name} is inactive`);
      if (it.currentStock.lt(total)) {
        throw new ActionError(
          `Not enough ${it.name} in stock — this issue needs ${total.toString()} ${it.unit} across its lines, only ${it.currentStock.toString()} ${it.unit} on hand`,
        );
      }
    }

    const created = await tx.housekeepingIssue.create({
      data: {
        issuedAt: istToUtc(input.issuedAt),
        recordedById: session.user.id,
        staffId: input.staffId,
        roomId: input.roomId,
        purpose: input.purpose ?? null,
        notes: input.notes ?? null,
        lines: {
          create: lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.qty,
            // Snapshot: the item's flag can be toggled later; the line keeps
            // what it meant when it was issued.
            reusable: byId.get(l.itemId)!.reusable,
          })),
        },
      },
    });
    const crossed: Array<{ id: string; name: string; unit: string; after: string }> = [];
    for (const [itemId, total] of totals) {
      const it = byId.get(itemId)!;
      // Reusable items move from clean stock into circulation (they'll come
      // back via a Return). Consumables just leave stock.
      await tx.housekeepingItem.update({
        where: { id: itemId },
        data: {
          currentStock: { decrement: total },
          ...(it.reusable ? { inCirculation: { increment: total } } : {}),
        },
      });
      const threshold = it.minStock ?? new Prisma.Decimal(0);
      const after = it.currentStock.minus(total);
      if (it.currentStock.gt(threshold) && after.lte(threshold)) {
        crossed.push({ id: itemId, name: it.name, unit: it.unit, after: after.toString() });
      }
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "HK_ISSUE_CREATED",
        entity: "HousekeepingIssue",
        entityId: created.id,
        payloadHash: sha256Json({
          issuedAt: input.issuedAt,
          staffId: input.staffId,
          roomId: input.roomId,
          lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() })),
        }),
      },
    });
    return { id: created.id, crossed, names: items.map((i) => i.name) };
  });

  if (issue.crossed.length > 0) {
    const day = formatIST(new Date(), "yyyy-MM-dd");
    deferAfterResponse("housekeeping:low-stock:notify", async () => {
      for (const it of issue.crossed) {
        await notifyRoles([Role.HOUSEKEEPING_MANAGER, Role.MANAGER], {
          kind: "GENERIC",
          title: "Housekeeping stock low",
          body: `${it.name}: ${it.after} ${it.unit} left`,
          link: "/housekeeping/items",
          dedupeKey: `hk-low:${it.id}:${day}`,
        });
      }
    });
  }
  tellHousekeepingManager(session, "housekeeping:issue:notify", {
    title: "Housekeeping issue recorded",
    body: `${issue.names.join(", ")} — by ${session.user.name ?? session.user.email}`,
    link: "/housekeeping/issues",
    dedupeKey: `hk-issue:${issue.id}`,
  });

  revalidatePath("/housekeeping/issues");
  revalidatePath("/housekeeping/items");
  revalidatePath("/housekeeping");
  return { ok: true, id: issue.id };
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
 * than is currently out. Every outcome leaves a HousekeepingAdjustment row
 * so the returns list can show what came back, what didn't, and from where.
 */
export async function returnHousekeepingStock(raw: unknown): Promise<ActionResult> {
  try {
    return await returnHousekeepingStockInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function returnHousekeepingStockInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = HousekeepingReturnInput.parse(raw);
  const qty = toQty(input.qty, "Return");
  const returned = input.outcome === "returned";
  const note = input.note?.trim() || null;

  const outcome = await db.$transaction(async (tx) => {
    await lockHousekeepingItemRows(tx, [input.itemId]);
    const item = await tx.housekeepingItem.findUnique({
      where: { id: input.itemId },
      select: { id: true, name: true, unit: true, reusable: true, currentStock: true, inCirculation: true },
    });
    if (!item) throw new ActionError("Item not found");
    if (!item.reusable) throw new ActionError(`${item.name} isn't a reusable item`);
    if (qty.gt(item.inCirculation)) {
      throw new ActionError(`Only ${item.inCirculation.toString()} ${item.unit} of ${item.name} are out in use — can't return ${qty.toString()}.`);
    }
    if (input.roomId) {
      const room = await tx.room.findUnique({ where: { id: input.roomId }, select: { id: true } });
      if (!room) throw new ActionError("Room not found");
    }
    if (input.staffId) {
      const staff = await tx.housekeepingStaff.findUnique({ where: { id: input.staffId }, select: { id: true } });
      if (!staff) throw new ActionError("Staff member not found");
    }

    const before = item.currentStock;
    const after = returned ? before.plus(qty) : before;
    await tx.housekeepingItem.update({
      where: { id: item.id },
      data: {
        inCirculation: { decrement: qty },
        ...(returned ? { currentStock: { increment: qty } } : {}),
      },
    });
    const adjustment = await tx.housekeepingAdjustment.create({
      data: {
        itemId: item.id,
        kind: returned ? StoreAdjustmentKind.RETURNED : StoreAdjustmentKind.LOST,
        delta: returned ? qty : new Prisma.Decimal(0),
        circulationDelta: qty.neg(),
        beforeQty: before,
        afterQty: after,
        reason: returned ? "Returned from room" : "Lost or damaged",
        note,
        roomId: input.roomId || null,
        staffId: input.staffId || null,
        byId: session.user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: returned ? "HK_REUSABLE_RETURNED" : "HK_REUSABLE_WRITTEN_OFF",
        entity: "HousekeepingItem",
        entityId: item.id,
        payloadHash: sha256Json({
          adjustmentId: adjustment.id,
          qty: qty.toString(),
          outcome: input.outcome,
          roomId: input.roomId || null,
          staffId: input.staffId || null,
          note,
        }),
      },
    });
    return { name: item.name, unit: item.unit, adjustmentId: adjustment.id };
  });

  if (!returned) {
    deferAfterResponse("housekeeping:lost:notify", () =>
      notifyRoles([Role.MANAGER, Role.ADMIN], {
        kind: "GENERIC",
        title: "Housekeeping linen written off",
        body: `${qty.toString()} ${outcome.unit} of ${outcome.name} lost or damaged${note ? ` · ${note}` : ""} — by ${session.user.name ?? session.user.email}`,
        link: "/housekeeping/returns",
        dedupeKey: `hk-lost:${outcome.adjustmentId}`,
      }),
    );
  }

  revalidatePath("/housekeeping/items");
  revalidatePath("/housekeeping/returns");
  revalidatePath("/housekeeping");
  return { ok: true };
}

/**
 * Returns, write-offs and hand adjustments, newest first. Room / staff are
 * plain ids on the adjustment row (no FK — they're optional context), so
 * they're resolved here rather than joined.
 */
export async function listHousekeepingAdjustments(
  opts: { from?: string; to?: string; limit?: number } = {},
) {
  await requireRole(READ_ROLES);
  const at = dateRange(opts.from, opts.to);
  const rows = await db.housekeepingAdjustment.findMany({
    where: at ? { at } : {},
    take: opts.limit ?? 200,
    orderBy: { at: "desc" },
    include: {
      item: { select: { id: true, name: true, unit: true } },
      by: { select: { id: true, name: true } },
    },
  });
  const roomIds = [...new Set(rows.map((r) => r.roomId).filter((x): x is string => !!x))];
  const staffIds = [...new Set(rows.map((r) => r.staffId).filter((x): x is string => !!x))];
  const [rooms, staff] = await Promise.all([
    roomIds.length
      ? db.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true, name: true } })
      : [],
    staffIds.length
      ? db.housekeepingStaff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    kind: r.kind,
    item: r.item,
    delta: r.delta.toString(),
    circulationDelta: r.circulationDelta.toString(),
    beforeQty: r.beforeQty.toString(),
    afterQty: r.afterQty.toString(),
    reason: r.reason,
    note: r.note,
    room: r.roomId ? (roomById.get(r.roomId) ?? null) : null,
    staff: r.staffId ? (staffById.get(r.staffId) ?? null) : null,
    by: r.by,
  }));
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
  const issuedAt = dateRange(opts.from, opts.to);
  if (issuedAt) where.issuedAt = issuedAt;
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

/** Half-open [from, toExclusive). A custom "to" day is included whole. */
function periodRange(p: ReportPeriod, from?: string, to?: string) {
  const now = new Date();
  if (p === "CUSTOM") {
    return {
      from: dayStart(from) ?? new Date(now.getFullYear(), 0, 1),
      toExclusive: dayEnd(to) ?? now,
    };
  }
  const days = p === "WEEK" ? 7 : p === "MONTH" ? 30 : 90;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return { from: d, toExclusive: now };
}

/**
 * Consumption — by item — over the given period. Consumption means the
 * consumable lines only (`reusable = false` as snapshotted at issue time):
 * a towel sent to a room isn't used up, it comes back. Reusables are
 * reported separately by `reusablesByItem`.
 */
export async function consumptionByItem(
  period: ReportPeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const { from, toExclusive } = periodRange(period, opts.from, opts.to);

  const grouped = await db.housekeepingIssueLine.groupBy({
    by: ["itemId"],
    where: { reusable: false, issue: { issuedAt: { gte: from, lt: toExclusive } } },
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
 * Reusable movement — by item — over the period: what went out to rooms,
 * what came back washed, what was written off. Issued from the issue lines
 * (reusable snapshot), returned / lost from the adjustment records.
 */
export async function reusablesByItem(
  period: ReportPeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const { from, toExclusive } = periodRange(period, opts.from, opts.to);

  const [issued, adjusted] = await Promise.all([
    db.housekeepingIssueLine.groupBy({
      by: ["itemId"],
      where: { reusable: true, issue: { issuedAt: { gte: from, lt: toExclusive } } },
      _sum: { quantity: true },
    }),
    db.housekeepingAdjustment.groupBy({
      by: ["itemId", "kind"],
      where: {
        kind: { in: [StoreAdjustmentKind.RETURNED, StoreAdjustmentKind.LOST] },
        at: { gte: from, lt: toExclusive },
      },
      _sum: { circulationDelta: true },
    }),
  ]);
  const ids = [...new Set([...issued.map((g) => g.itemId), ...adjusted.map((g) => g.itemId)])];
  if (ids.length === 0) return [];
  const items = await db.housekeepingItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, unit: true, inCirculation: true },
  });
  const zero = new Prisma.Decimal(0);
  const issuedById = new Map(issued.map((g) => [g.itemId, g._sum.quantity ?? zero]));
  // circulationDelta is negative for both kinds — flip it to "how many".
  const back = (itemId: string, kind: StoreAdjustmentKind) =>
    adjusted.find((g) => g.itemId === itemId && g.kind === kind)?._sum.circulationDelta?.neg() ?? zero;
  return items
    .map((i) => ({
      itemId: i.id,
      name: i.name,
      unit: i.unit,
      issued: (issuedById.get(i.id) ?? zero).toString(),
      returned: back(i.id, StoreAdjustmentKind.RETURNED).toString(),
      lost: back(i.id, StoreAdjustmentKind.LOST).toString(),
      inCirculation: i.inCirculation.toString(),
    }))
    .sort((a, b) => Number(b.issued) - Number(a.issued));
}

/**
 * Consumption — by room and item — over the period. One row per (room,
 * item) with the item's unit: "12 pieces + 3 kg" is not a number, so there
 * is deliberately no cross-item total.
 */
export async function consumptionByRoom(
  period: ReportPeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const { from, toExclusive } = periodRange(period, opts.from, opts.to);

  const rows = await db.$queryRaw<
    Array<{ roomId: string; itemId: string; qty: string }>
  >`
    SELECT i."roomId", l."itemId", SUM(l."quantity")::text AS qty
    FROM "HousekeepingIssueLine" l
    JOIN "HousekeepingIssue" i ON i."id" = l."issueId"
    WHERE l."reusable" = false
      AND i."issuedAt" >= ${from} AND i."issuedAt" < ${toExclusive}
    GROUP BY i."roomId", l."itemId"
  `;
  if (rows.length === 0) return [];
  const [rooms, items] = await Promise.all([
    db.room.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.roomId))] } },
      select: { id: true, number: true, name: true },
    }),
    db.housekeepingItem.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.itemId))] } },
      select: { id: true, name: true, unit: true },
    }),
  ]);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  return rows
    .map((r) => ({
      roomId: r.roomId,
      roomNumber: roomById.get(r.roomId)?.number ?? "—",
      roomName: roomById.get(r.roomId)?.name ?? null,
      itemId: r.itemId,
      itemName: itemById.get(r.itemId)?.name ?? "—",
      unit: itemById.get(r.itemId)?.unit ?? "",
      qty: r.qty,
    }))
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber) || a.itemName.localeCompare(b.itemName));
}

/**
 * Trips and consumable units — by staff — over the given period. Trips
 * count every issue (linen runs included); units count consumables only.
 */
export async function consumptionByStaff(
  period: ReportPeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const { from, toExclusive } = periodRange(period, opts.from, opts.to);
  const rows = await db.$queryRaw<
    Array<{ staffId: string; total: string; trips: bigint }>
  >`
    SELECT i."staffId",
           COALESCE(SUM(CASE WHEN l."reusable" THEN 0 ELSE l."quantity" END), 0)::text AS total,
           COUNT(DISTINCT i."id") AS trips
    FROM "HousekeepingIssueLine" l
    JOIN "HousekeepingIssue" i ON i."id" = l."issueId"
    WHERE i."issuedAt" >= ${from} AND i."issuedAt" < ${toExclusive}
    GROUP BY i."staffId"
  `;
  if (rows.length === 0) return [];
  const staff = await db.housekeepingStaff.findMany({
    where: { id: { in: rows.map((r) => r.staffId) } },
    select: { id: true, name: true },
  });
  const byId = new Map(staff.map((s) => [s.id, s]));
  return rows
    .map((r) => ({
      staffId: r.staffId,
      staffName: byId.get(r.staffId)?.name ?? "—",
      totalUnits: r.total,
      trips: Number(r.trips),
    }))
    .sort((a, b) => Number(b.totalUnits) - Number(a.totalUnits) || b.trips - a.trips);
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
    .filter((i) => i.minStock !== null && i.currentStock.lte(i.minStock))
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      currentStock: i.currentStock.toString(),
      minStock: i.minStock!.toString(),
    }));

  // This-week consumption (consumable units — value isn't tracked unless
  // costPerUnit was set on receipts; total units is the v1 KPI). Top-5
  // consumed items.
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
