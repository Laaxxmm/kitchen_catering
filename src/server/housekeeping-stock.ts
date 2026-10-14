import { Prisma, Role } from "@prisma/client";
import { formatIST, istDayWindow, istToUtc } from "@/lib/time";
import { sha256Json } from "@/lib/audit";
import { deferAfterResponse } from "@/server/defer";
import { notifyRoles } from "@/server/notification-core";
import { ActionError } from "@/server/action-result";

/**
 * Housekeeping stock movements shared by the server actions — kept out of
 * the "use server" files so nothing here becomes a callable endpoint. The
 * direct issue-to-room and closing a job with items both draw stock through
 * `drawHousekeepingIssue`, so there is one implementation of the rules.
 */

type Tx = Prisma.TransactionClient;

/**
 * Row-lock housekeeping items for the rest of the transaction. Every stock
 * movement (receipt / issue / return) reads or updates currentStock /
 * inCirculation — without the lock two concurrent movements read the same
 * snapshot and one update is silently lost (stock can even go negative past
 * the availability check). FOR UPDATE serialises them; ids are locked in a
 * stable order so concurrent multi-line movements can't deadlock.
 */
export async function lockHousekeepingItemRows(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$executeRaw`SELECT 1 FROM "HousekeepingItem" WHERE "id" = ${id} FOR UPDATE`;
  }
}

/** Quantities live at 3 dp. Anything that rounds to nothing is refused
 *  rather than written as a 0-quantity line. */
export function toQty(raw: string, what: string): Prisma.Decimal {
  const q = new Prisma.Decimal(raw).toDecimalPlaces(3);
  if (q.lte(0)) throw new ActionError(`${what}: quantity must be at least 0.001`);
  return q;
}

/** "YYYY-MM-DD" (an IST calendar day) → UTC start of that day. Anything
 *  else — blank, malformed, 31 Feb — is ignored rather than crashing the
 *  page. */
export function dayStart(s?: string): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  try {
    const d = istToUtc(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  } catch {
    return undefined;
  }
}

/** The moment the "to" day ends — half-open, so the whole day is included. */
export function dayEnd(s?: string): Date | undefined {
  const d = dayStart(s);
  return d ? istDayWindow(d).toExclusive : undefined;
}

export function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const gte = dayStart(from);
  const lt = dayEnd(to);
  if (!gte && !lt) return undefined;
  return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}

export interface LowStockCrossing {
  id: string;
  name: string;
  unit: string;
  after: string;
}

/**
 * Write one HousekeepingIssue and take its items out of the store, inside
 * the caller's transaction. Availability is checked per ITEM under the row
 * lock — two lines for the same towel must not each pass against the same
 * snapshot and overdraw together. Consumables leave stock; reusables move
 * into circulation (they come back via a Return). Each line snapshots the
 * item's `reusable` flag. Returns the items that crossed their low-stock
 * line — hand them to `notifyHousekeepingLowStock` AFTER the commit.
 */
export async function drawHousekeepingIssue(
  tx: Tx,
  input: {
    recordedById: string;
    issuedAt: Date;
    staffId: string;
    roomId: string;
    purpose: string | null;
    notes: string | null;
    jobId?: string;
    lines: Array<{ itemId: string; qty: Prisma.Decimal }>;
  },
): Promise<{ id: string; names: string[]; crossed: LowStockCrossing[] }> {
  if (input.lines.length === 0) throw new ActionError("Add at least one item");
  const totals = new Map<string, Prisma.Decimal>();
  for (const l of input.lines) {
    totals.set(l.itemId, (totals.get(l.itemId) ?? new Prisma.Decimal(0)).plus(l.qty));
  }
  const itemIds = [...totals.keys()];

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
      issuedAt: input.issuedAt,
      recordedById: input.recordedById,
      staffId: input.staffId,
      roomId: input.roomId,
      purpose: input.purpose,
      notes: input.notes,
      jobId: input.jobId ?? null,
      lines: {
        create: input.lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.qty,
          // Snapshot: the item's flag can be toggled later; the line keeps
          // what it meant when it was issued.
          reusable: byId.get(l.itemId)!.reusable,
        })),
      },
    },
  });
  const crossed: LowStockCrossing[] = [];
  for (const [itemId, total] of totals) {
    const it = byId.get(itemId)!;
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
      userId: input.recordedById,
      action: "HK_ISSUE_CREATED",
      entity: "HousekeepingIssue",
      entityId: created.id,
      payloadHash: sha256Json({
        issuedAt: input.issuedAt.toISOString(),
        staffId: input.staffId,
        roomId: input.roomId,
        jobId: input.jobId ?? null,
        lines: input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() })),
      }),
    },
  });
  return { id: created.id, names: items.map((i) => i.name), crossed };
}

/** Once a day per item: the desk and the manager hear an item went low. */
export function notifyHousekeepingLowStock(crossed: LowStockCrossing[]) {
  if (crossed.length === 0) return;
  const day = formatIST(new Date(), "yyyy-MM-dd");
  deferAfterResponse("housekeeping:low-stock:notify", async () => {
    for (const it of crossed) {
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
