"use server";

import { revalidatePath } from "next/cache";
import {
  BanquetRequisitionLineStatus,
  BanquetRequisitionStatus,
  OrderChannel,
  Prisma,
  Role,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { requireRole, requireSession } from "@/server/rbac";
import { istToUtc } from "@/lib/time";
import { sha256Json } from "@/lib/audit";
import { INACTIVE_ORDER_STATUSES } from "@/lib/order-status";
import { createNotification, notifyRoles } from "@/server/actions/notifications";
import { deferAfterResponse } from "@/server/defer";
import { nextBanquetRequisitionNumber } from "@/lib/sequences";
import {
  BanquetItemInput,
  BanquetIssueInput,
  BanquetReceiptInput,
  BanquetRequisitionAwaitingInput,
  BanquetRequisitionInput,
  BanquetRequisitionIssueInput,
  BanquetReturnInput,
  BanquetStockCountInput,
} from "@/lib/validators";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

/**
 * Row-lock banquet items for the rest of the transaction. Every stock
 * movement (receipt / issue) reads or updates currentStock — without the
 * lock two concurrent movements read the same snapshot and one update is
 * silently lost (stock can even go negative past the availability check).
 * FOR UPDATE serialises them; ids are locked in a stable order so
 * concurrent multi-line movements can't deadlock.
 */
async function lockBanquetItemRows(tx: Prisma.TransactionClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$executeRaw`SELECT 1 FROM "BanquetItem" WHERE "id" = ${id} FOR UPDATE`;
  }
}

// Banquet store — service-side disposables (cups, trays, tissue, foil,
// takeaway boxes …). Same shape as housekeeping but the issues link to
// an Order or a free-text purpose instead of a Room.
//
// Roles:
//   FNB_SERVICE  — drives the module (raises requisitions, records
//                  receipts + issues against day-of-event consumption).
//   ADMIN / MGR  — full read+write for oversight + reports.
//   DELIVERY     — reads the store and issues cutlery/disposables to an
//                  off-site event (banquet / ODC / packed), since the
//                  delivery team prepares those arrangements. They can't
//                  manage items, record vendor receipts or adjust stock.

// F&B Service is one team now (role DELIVERY, FNB_SERVICE its retired alias):
// they run the banquet store end to end — catalogue, receipts, issues.
const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY];
// Stock movements (issue out / return in) include the store keeper — in
// this operation they physically run the store counter alongside F&B.
const ISSUE_ROLES = [...WRITE_ROLES, Role.STORE_KEEPER];
// The store keeper also records receipts (stock IN). Catalogue management
// (add/edit/delete items) stays with WRITE_ROLES; direct stock-set goes
// through adjustStoreStock, which enforces the stock.storeDirectEdit toggle.
const RECEIPT_ROLES = [...WRITE_ROLES, Role.STORE_KEEPER];
const READ_ROLES: Role[] = [...WRITE_ROLES, Role.STORE_KEEPER];

// ─── Items ────────────────────────────────────────────────────────────

export async function upsertBanquetItem(raw: unknown, id?: string) {
  // Store keeper may CREATE a new banquet item (they load/correct stock and
  // often add the SKU they're receiving), but editing the catalogue stays
  // with WRITE_ROLES — mirrors the kitchen pattern where SALES can add a dish
  // but not edit the catalogue. Gate dynamically on create-vs-update.
  const session = await requireRole(id ? WRITE_ROLES : [...WRITE_ROLES, Role.STORE_KEEPER]);
  const input = BanquetItemInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    if (id) {
      const updated = await tx.banquetItem.update({
        where: { id },
        data: {
          name: input.name,
          sku: input.sku ?? null,
          category: input.category ?? null,
          unit: input.unit,
          minStock: input.minStock ? new Prisma.Decimal(input.minStock) : null,
          notes: input.notes ?? null,
          active: input.active ?? true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "BANQUET_ITEM_UPDATED",
          entity: "BanquetItem",
          entityId: updated.id,
        },
      });
      return updated;
    }
    const opening = input.openingStock ? new Prisma.Decimal(input.openingStock) : null;
    const created = await tx.banquetItem.create({
      data: {
        name: input.name,
        sku: input.sku ?? null,
        category: input.category ?? null,
        unit: input.unit,
        minStock: input.minStock ? new Prisma.Decimal(input.minStock) : null,
        notes: input.notes ?? null,
        active: input.active ?? true,
        currentStock: opening && opening.gt(0) ? opening : new Prisma.Decimal(0),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_ITEM_CREATED",
        entity: "BanquetItem",
        entityId: created.id,
      },
    });
    if (opening && opening.gt(0)) {
      const receipt = await tx.banquetReceipt.create({
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
          action: "BANQUET_OPENING_BALANCE_SET",
          entity: "BanquetReceipt",
          entityId: receipt.id,
        },
      });
    }
    return created;
  });

  revalidatePath("/banquet/items");
  revalidatePath("/banquet");
  return { id: row.id };
}

export async function deactivateBanquetItem(id: string) {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    await tx.banquetItem.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_ITEM_DEACTIVATED",
        entity: "BanquetItem",
        entityId: id,
      },
    });
  });
  revalidatePath("/banquet/items");
}

export async function deleteBanquetItem(id: string) {
  const session = await requireRole(WRITE_ROLES);
  const [receiptLines, issueLines] = await Promise.all([
    db.banquetReceiptLine.count({ where: { itemId: id } }),
    db.banquetIssueLine.count({ where: { itemId: id } }),
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
    await tx.banquetItem.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_ITEM_DELETED",
        entity: "BanquetItem",
        entityId: id,
      },
    });
  });
  revalidatePath("/banquet/items");
  revalidatePath("/banquet");
}

export async function listBanquetItems(opts: { activeOnly?: boolean } = {}) {
  await requireRole(READ_ROLES);
  return db.banquetItem.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
  });
}

// ─── Receipts ─────────────────────────────────────────────────────────

export async function recordBanquetReceipt(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordBanquetReceiptInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordBanquetReceiptInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(RECEIPT_ROLES);
  const input = BanquetReceiptInput.parse(raw);

  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    qty: new Prisma.Decimal(l.quantity),
    costPerUnit: l.costPerUnit ? new Prisma.Decimal(l.costPerUnit) : null,
  }));
  for (const l of lines) {
    if (l.qty.lessThanOrEqualTo(0)) throw new ActionError("Quantity must be > 0");
  }

  const receipt = await db.$transaction(async (tx) => {
    await lockBanquetItemRows(tx, lines.map((l) => l.itemId));
    const created = await tx.banquetReceipt.create({
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
      await tx.banquetItem.update({
        where: { id: l.itemId },
        data: { currentStock: { increment: l.qty } },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_RECEIPT_CREATED",
        entity: "BanquetReceipt",
        entityId: created.id,
      },
    });
    return created;
  });

  revalidatePath("/banquet/receipts");
  revalidatePath("/banquet/items");
  revalidatePath("/banquet");
  return { ok: true, id: receipt.id };
}

export async function listBanquetReceipts(opts: { limit?: number } = {}) {
  await requireRole(READ_ROLES);
  return db.banquetReceipt.findMany({
    take: opts.limit ?? 100,
    orderBy: { receivedAt: "desc" },
    include: {
      recordedBy: { select: { id: true, name: true } },
      lines: { include: { item: { select: { id: true, name: true, unit: true, category: true } } } },
    },
  });
}

// ─── Issues (to service area / event) ─────────────────────────────────

export async function recordBanquetIssue(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordBanquetIssueInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordBanquetIssueInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(ISSUE_ROLES);
  const input = BanquetIssueInput.parse(raw);

  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    qty: new Prisma.Decimal(l.quantity),
  }));
  for (const l of lines) {
    if (l.qty.lessThanOrEqualTo(0)) throw new ActionError("Quantity must be > 0");
  }

  const issue = await db.$transaction(async (tx) => {
    // Lock BEFORE the availability check — a pre-check outside the lock could
    // pass for two concurrent issues that together overdraw.
    await lockBanquetItemRows(tx, lines.map((l) => l.itemId));
    return writeBanquetIssueLocked(tx, {
      issuedAt: istToUtc(input.issuedAt),
      recordedById: session.user.id,
      purpose: input.purpose.trim(),
      orderId: input.orderId ?? null,
      notes: input.notes?.trim() || null,
      lines,
    });
  });

  revalidatePath("/banquet/issues");
  revalidatePath("/banquet/items");
  revalidatePath("/banquet");
  return { ok: true, id: issue.id };
}

/**
 * Write a real BanquetIssue (stock OUT) inside an existing transaction whose
 * item rows the caller has ALREADY locked via lockBanquetItemRows. Checks
 * availability, creates the issue + lines, decrements currentStock and audits.
 * Shared by recordBanquetIssue (manual issue) and issueBanquetRequisitionLine
 * (requisition fulfilment) so the cutlery ledger + returns behave identically
 * however the stock left the store.
 */
async function writeBanquetIssueLocked(
  tx: Prisma.TransactionClient,
  input: {
    issuedAt: Date;
    recordedById: string;
    purpose: string;
    orderId: string | null;
    notes: string | null;
    lines: { itemId: string; qty: Prisma.Decimal }[];
  },
) {
  const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
  const items = await tx.banquetItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, currentStock: true, unit: true, active: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const l of input.lines) {
    const it = byId.get(l.itemId);
    if (!it) throw new ActionError("Item not found");
    if (!it.active) throw new ActionError(`Item ${it.name} is inactive`);
    if (new Decimal(it.currentStock.toString()).lt(new Decimal(l.qty.toString()))) {
      throw new ActionError(
        `Not enough ${it.name} in stock (have ${it.currentStock.toString()} ${it.unit})`,
      );
    }
  }

  const created = await tx.banquetIssue.create({
    data: {
      issuedAt: input.issuedAt,
      recordedById: input.recordedById,
      purpose: input.purpose,
      orderId: input.orderId,
      notes: input.notes,
      lines: { create: input.lines.map((l) => ({ itemId: l.itemId, quantity: l.qty })) },
    },
  });
  for (const l of input.lines) {
    await tx.banquetItem.update({
      where: { id: l.itemId },
      data: { currentStock: { decrement: l.qty } },
    });
  }
  await tx.auditLog.create({
    data: {
      userId: input.recordedById,
      action: "BANQUET_ISSUE_CREATED",
      entity: "BanquetIssue",
      entityId: created.id,
    },
  });
  return created;
}

// ─── Cutlery returns (per-event ledger) ─────────────────────────────
//
// Issues linked to an order say what went OUT to the client's event;
// returns say what came BACK. The difference is what's still out —
// chargeable to the client or the delivery handler.

export async function recordBanquetReturn(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordBanquetReturnInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordBanquetReturnInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(ISSUE_ROLES);
  const input = BanquetReturnInput.parse(raw);

  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    qty: new Prisma.Decimal(l.quantity),
  }));
  for (const l of lines) {
    if (l.qty.lessThanOrEqualTo(0)) throw new ActionError("Quantity must be > 0");
  }
  const itemIds = [...new Set(lines.map((l) => l.itemId))];

  const ret = await db.$transaction(async (tx) => {
    await lockBanquetItemRows(tx, itemIds);

    // Can't take back more than is still out with this client: per item,
    // returned-so-far + this return must stay within what was issued to
    // the order.
    const [issued, returned, items] = await Promise.all([
      tx.banquetIssueLine.groupBy({
        by: ["itemId"],
        where: { itemId: { in: itemIds }, issue: { orderId: input.orderId } },
        _sum: { quantity: true },
      }),
      tx.banquetReturnLine.groupBy({
        by: ["itemId"],
        where: { itemId: { in: itemIds }, return: { orderId: input.orderId } },
        _sum: { quantity: true },
      }),
      tx.banquetItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true, unit: true },
      }),
    ]);
    const issuedBy = new Map(issued.map((r) => [r.itemId, new Decimal(r._sum.quantity?.toString() ?? "0")]));
    const returnedBy = new Map(returned.map((r) => [r.itemId, new Decimal(r._sum.quantity?.toString() ?? "0")]));
    const nameBy = new Map(items.map((i) => [i.id, i]));

    for (const l of lines) {
      const item = nameBy.get(l.itemId);
      if (!item) throw new ActionError("Item not found");
      const out = (issuedBy.get(l.itemId) ?? new Decimal(0)).minus(returnedBy.get(l.itemId) ?? new Decimal(0));
      if (new Decimal(l.qty.toString()).gt(out)) {
        throw new ActionError(
          `Only ${out.toString()} ${item.unit} of ${item.name} is still out with this client — can't record ${l.qty.toString()} back.`,
        );
      }
    }

    const created = await tx.banquetReturn.create({
      data: {
        returnedAt: istToUtc(input.returnedAt),
        recordedById: session.user.id,
        orderId: input.orderId,
        notes: input.notes?.trim() || null,
        lines: { create: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty })) },
      },
    });
    for (const l of lines) {
      await tx.banquetItem.update({
        where: { id: l.itemId },
        data: { currentStock: { increment: l.qty } },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_RETURN_RECORDED",
        entity: "BanquetReturn",
        entityId: created.id,
        payloadHash: sha256Json({ orderId: input.orderId, lines: lines.length }),
      },
    });
    return created;
  });

  revalidatePath("/banquet/items");
  revalidatePath("/banquet");
  revalidatePath(`/deliveries/event-prep/${input.orderId}`);
  return { ok: true, id: ret.id };
}

// ─── Bulk stock count ─────────────────────────────────────────────────
//
// Row-wise physical count for the whole store, mirroring the kitchen's
// monthly audit (inventory-audit.ts): every counted line sets the item's
// on-hand to the physical quantity, only changed lines post, and each
// change lands in the audit log. Like the kitchen bulk count, this is the
// formal fully-audited flow, so it includes the STORE_KEEPER regardless of
// the stock.storeDirectEdit toggle (which keeps gating the single-item
// adjustStoreStock path).
const STOCK_COUNT_ROLES = [...WRITE_ROLES, Role.STORE_KEEPER];

export interface BanquetStockCountChange {
  name: string;
  before: string;
  after: string;
}

export async function postBanquetStockCount(
  raw: unknown,
): Promise<ActionResultWith<{ changes: BanquetStockCountChange[] }>> {
  try {
    return await postBanquetStockCountInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function postBanquetStockCountInner(
  raw: unknown,
): Promise<{ ok: true; changes: BanquetStockCountChange[] }> {
  const session = await requireRole(STOCK_COUNT_ROLES);
  const input = BanquetStockCountInput.parse(raw);

  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    counted: new Decimal(l.countedQty),
  }));
  for (const l of lines) {
    if (l.counted.isNaN()) throw new ActionError("Counted quantity must be a number");
    if (l.counted.lt(0)) throw new ActionError("Counted quantity cannot be negative");
  }

  const changes = await db.$transaction(async (tx) => {
    // Lock every counted row up front (stable order — see lockBanquetItemRows)
    // so concurrent receipts/issues can't interleave with the read-then-set.
    await lockBanquetItemRows(tx, lines.map((l) => l.itemId));

    const out: BanquetStockCountChange[] = [];
    for (const l of lines) {
      const item = await tx.banquetItem.findUnique({
        where: { id: l.itemId },
        select: { id: true, name: true, currentStock: true },
      });
      if (!item) continue;

      const before = new Decimal(item.currentStock.toString());
      const after = l.counted;
      if (after.eq(before)) continue; // unchanged — skip, no audit noise

      await tx.banquetItem.update({
        where: { id: item.id },
        data: { currentStock: after.toDecimalPlaces(3).toString() },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "BANQUET_STOCK_COUNT_ADJUSTED",
          entity: "BanquetItem",
          entityId: item.id,
          payloadHash: sha256Json({
            name: item.name,
            before: before.toString(),
            after: after.toString(),
          }),
        },
      });
      out.push({ name: item.name, before: before.toString(), after: after.toString() });
    }

    // One summary row for the posting as a whole (count + notes).
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_STOCK_COUNT_POSTED",
        entity: "BanquetItem",
        entityId: "stock-count",
        payloadHash: sha256Json({ changed: out.length, notes: input.notes ?? null }),
      },
    });

    return out;
  });

  revalidatePath("/banquet");
  revalidatePath("/banquet/items");
  return { ok: true, changes };
}

/**
 * Per-order cutlery ledger: what was issued to the event, what came
 * back, what's still out — per item.
 */
export async function getOrderCutleryLedger(orderId: string) {
  await requireRole([Role.ADMIN, Role.MANAGER, Role.DELIVERY, Role.FNB_SERVICE, Role.ACCOUNTS]);
  const [issued, returned] = await Promise.all([
    db.banquetIssueLine.groupBy({
      by: ["itemId"],
      where: { issue: { orderId } },
      _sum: { quantity: true },
    }),
    db.banquetReturnLine.groupBy({
      by: ["itemId"],
      where: { return: { orderId } },
      _sum: { quantity: true },
    }),
  ]);
  const itemIds = [...new Set([...issued.map((r) => r.itemId), ...returned.map((r) => r.itemId)])];
  if (itemIds.length === 0) return [];
  const items = await db.banquetItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, unit: true },
  });
  const returnedBy = new Map(returned.map((r) => [r.itemId, r._sum.quantity?.toString() ?? "0"]));
  return issued.map((r) => {
    const item = items.find((i) => i.id === r.itemId);
    const iss = new Decimal(r._sum.quantity?.toString() ?? "0");
    const back = new Decimal(returnedBy.get(r.itemId) ?? "0");
    return {
      itemId: r.itemId,
      name: item?.name ?? "?",
      unit: item?.unit ?? "piece",
      issued: iss.toString(),
      returned: back.toString(),
      outstanding: iss.minus(back).toString(),
    };
  });
}

export interface ListBanquetIssuesOpts {
  from?: string;
  to?: string;
  orderId?: string;
  itemId?: string;
  limit?: number;
}

export async function listBanquetIssues(opts: ListBanquetIssuesOpts = {}) {
  await requireRole(READ_ROLES);
  const where: Prisma.BanquetIssueWhereInput = {};
  if (opts.from || opts.to) {
    where.issuedAt = {};
    if (opts.from) (where.issuedAt as Prisma.DateTimeFilter).gte = istToUtc(opts.from);
    if (opts.to) (where.issuedAt as Prisma.DateTimeFilter).lte = istToUtc(opts.to);
  }
  if (opts.orderId) where.orderId = opts.orderId;
  if (opts.itemId) where.lines = { some: { itemId: opts.itemId } };

  return db.banquetIssue.findMany({
    where,
    take: opts.limit ?? 200,
    orderBy: { issuedAt: "desc" },
    include: {
      recordedBy: { select: { id: true, name: true } },
      order: { select: { id: true, code: true } },
      lines: { include: { item: { select: { id: true, name: true, unit: true, category: true } } } },
    },
  });
}

// ─── Reports ──────────────────────────────────────────────────────────

export type BanquetPeriod = "WEEK" | "MONTH" | "QUARTER" | "CUSTOM";

function periodRange(p: BanquetPeriod, from?: string, to?: string) {
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

export async function banquetConsumptionByItem(
  period: BanquetPeriod,
  opts: { from?: string; to?: string } = {}
) {
  await requireRole(READ_ROLES);
  const { from, to } = periodRange(period, opts.from, opts.to);
  const grouped = await db.banquetIssueLine.groupBy({
    by: ["itemId"],
    where: { issue: { issuedAt: { gte: from, lte: to } } },
    _sum: { quantity: true },
  });
  const items = await db.banquetItem.findMany({
    where: { id: { in: grouped.map((g) => g.itemId) } },
    select: { id: true, name: true, unit: true, category: true, currentStock: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  return grouped
    .map((g) => ({
      itemId: g.itemId,
      name: byId.get(g.itemId)?.name ?? "—",
      unit: byId.get(g.itemId)?.unit ?? "",
      category: byId.get(g.itemId)?.category ?? "",
      currentStock: byId.get(g.itemId)?.currentStock.toString() ?? "0",
      consumed: g._sum.quantity?.toString() ?? "0",
    }))
    .sort((a, b) => Number(b.consumed) - Number(a.consumed));
}

export async function banquetSummary() {
  await requireRole(READ_ROLES);
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [itemCount, lowStock, recentReceipts, recentIssues] = await Promise.all([
    db.banquetItem.count({ where: { active: true } }),
    db.banquetItem.findMany({
      where: { active: true, minStock: { not: null } },
      select: { id: true, name: true, unit: true, category: true, currentStock: true, minStock: true },
    }),
    db.banquetReceipt.count({ where: { receivedAt: { gte: oneWeekAgo } } }),
    db.banquetIssue.count({ where: { issuedAt: { gte: oneWeekAgo } } }),
  ]);
  const lows = lowStock
    .filter((i) => {
      if (!i.minStock) return false;
      return new Decimal(i.currentStock.toString()).lte(new Decimal(i.minStock.toString()));
    })
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      category: i.category,
      currentStock: i.currentStock.toString(),
      minStock: i.minStock!.toString(),
    }));
  const topConsumed = await banquetConsumptionByItem("WEEK");
  return {
    itemCount,
    lowStock: lows,
    receiptsLastWeek: recentReceipts,
    issuesLastWeek: recentIssues,
    topItemsThisWeek: topConsumed.slice(0, 5),
  };
}

// ─── Events (for the issue-to-event dropdown) ────────────────────────────
// Off-site catering orders (banquet / ODC / packed) still in flight — the F&B
// team picks one when issuing cutlery/disposables so the consumption links to
// the event's order (and its P&L).
export async function listBanquetEvents() {
  await requireRole(READ_ROLES);
  const rows = await db.order.findMany({
    where: {
      channel: { in: [OrderChannel.BANQUET, OrderChannel.BUFFET, OrderChannel.ODC, OrderChannel.PACKET] },
      status: { notIn: INACTIVE_ORDER_STATUSES },
    },
    select: { id: true, code: true, channel: true, eventDate: true, customer: { select: { name: true } } },
    orderBy: { eventDate: "asc" },
    take: 100,
  });
  return rows.map((o) => ({
    id: o.id,
    code: o.code,
    channel: o.channel,
    eventDate: o.eventDate.toISOString(),
    customerName: o.customer.name,
  }));
}

// ─── Banquet requisitions (F&B → store, line-by-line fulfilment) ─────────
//
// Replaces the old free-text requestGoodsFromStore Task. F&B service raises a
// BanquetRequisition against banquet-store stock; the store keeper fulfils it
// line by line — issue full / partial, or flag a shortfall for a purchase
// order. Mirrors the chef ingredient-requisition flow (chef-requisitions.ts)
// but against BanquetItem stock instead of Ingredient.

// F&B raises the requisition; the store keeper (also in ISSUE_ROLES) fulfils.
const REQUISITION_ROLES = ISSUE_ROLES;

const REQ_LINE_CLOSED: BanquetRequisitionLineStatus[] = [
  BanquetRequisitionLineStatus.ISSUED,
  BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
  BanquetRequisitionLineStatus.CANCELLED,
];

/**
 * Recompute a requisition's rolled-up status from its lines and stamp who
 * last touched it. All lines closed (issued / awaiting-PO / cancelled) →
 * FULLY_ISSUED + closedAt; any progress (issued / part / awaiting) but work
 * still open → PARTIALLY_ISSUED; otherwise SUBMITTED.
 */
async function recomputeBanquetReqStatus(
  tx: Prisma.TransactionClient,
  reqId: string,
  fulfilledById: string,
): Promise<BanquetRequisitionStatus> {
  const lines = await tx.banquetRequisitionLine.findMany({
    where: { requisitionId: reqId },
    select: { status: true },
  });
  const allClosed = lines.every((l) => REQ_LINE_CLOSED.includes(l.status));
  const anyProgress = lines.some(
    (l) =>
      l.status === BanquetRequisitionLineStatus.ISSUED ||
      l.status === BanquetRequisitionLineStatus.PARTIALLY_ISSUED ||
      l.status === BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
  );
  const status = allClosed
    ? BanquetRequisitionStatus.FULLY_ISSUED
    : anyProgress
      ? BanquetRequisitionStatus.PARTIALLY_ISSUED
      : BanquetRequisitionStatus.SUBMITTED;
  await tx.banquetRequisition.update({
    where: { id: reqId },
    data: {
      status,
      lastFulfilledById: fulfilledById,
      closedAt: allClosed ? new Date() : null,
    },
  });
  return status;
}

/**
 * F&B service raises a banquet requisition. Creates it SUBMITTED with PENDING
 * lines and notifies the store team to issue it.
 */
export async function createBanquetRequisition(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; requisitionNo: string }>> {
  try {
    return await createBanquetRequisitionInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createBanquetRequisitionInner(
  raw: unknown,
): Promise<{ ok: true; id: string; requisitionNo: string }> {
  const session = await requireRole(REQUISITION_ROLES);
  const input = BanquetRequisitionInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const requisitionNo = await nextBanquetRequisitionNumber(tx);
    const created = await tx.banquetRequisition.create({
      data: {
        requisitionNo,
        orderId: input.orderId ?? null,
        status: BanquetRequisitionStatus.SUBMITTED,
        submittedAt: new Date(),
        notes: input.notes ?? null,
        createdById: session.user.id,
        lines: {
          create: input.lines.map((l) => ({
            itemId: l.itemId,
            requestedQty: new Prisma.Decimal(l.requestedQty),
            status: BanquetRequisitionLineStatus.PENDING,
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_REQUISITION_CREATED",
        entity: "BanquetRequisition",
        entityId: created.id,
        payloadHash: sha256Json({ orderId: input.orderId ?? null, lines: input.lines.length }),
      },
    });
    return created;
  });

  deferAfterResponse("banquet-req:notify", () =>
    notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
      kind: "GENERIC",
      title: `F&B stock request ${result.requisitionNo}`,
      body: `${input.lines.length} item${input.lines.length === 1 ? "" : "s"} to issue from the banquet store.`,
      link: `/banquet/requisitions/${result.id}`,
      dedupeKey: `banquet-req:${result.id}`,
    }),
  );

  revalidatePath("/banquet/requisitions");
  revalidatePath("/banquet");
  return { ok: true, id: result.id, requisitionNo: result.requisitionNo };
}

/**
 * Issue stock for one requisition line (full or partial). Decrements
 * BanquetItem.currentStock through the shared locked-issue writer (so a real
 * BanquetIssue row lands for the cutlery ledger + returns), bumps the line's
 * issuedQty/status and rolls the parent requisition status forward.
 */
export async function issueBanquetRequisitionLine(raw: unknown): Promise<ActionResult> {
  try {
    return await issueBanquetRequisitionLineInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function issueBanquetRequisitionLineInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(REQUISITION_ROLES);
  const input = BanquetRequisitionIssueInput.parse(raw);

  const issued = await db.$transaction(async (tx) => {
    // Serialise concurrent issuers of the same line: lock the line row before
    // reading, so the loser waits and then sees the winner's committed state.
    await tx.$executeRaw`SELECT 1 FROM "BanquetRequisitionLine" WHERE "id" = ${input.requisitionLineId} FOR UPDATE`;
    const line = await tx.banquetRequisitionLine.findUnique({
      where: { id: input.requisitionLineId },
      include: {
        requisition: {
          select: {
            id: true,
            status: true,
            orderId: true,
            requisitionNo: true,
            createdById: true,
            createdBy: { select: { name: true } },
          },
        },
        item: { select: { id: true, name: true, unit: true } },
      },
    });
    if (!line) throw new ActionError("Requisition line not found");
    if (line.status === BanquetRequisitionLineStatus.CANCELLED) {
      throw new ActionError("Line is cancelled");
    }
    if (line.status === BanquetRequisitionLineStatus.ISSUED) {
      throw new ActionError("Line is already fully issued");
    }
    if (
      line.requisition.status !== BanquetRequisitionStatus.SUBMITTED &&
      line.requisition.status !== BanquetRequisitionStatus.PARTIALLY_ISSUED
    ) {
      throw new ActionError(
        `Cannot issue against a ${line.requisition.status.toLowerCase()} requisition`,
      );
    }

    // Lock the parent (status recompute) then the item (stock decrement).
    await tx.$executeRaw`SELECT 1 FROM "BanquetRequisition" WHERE "id" = ${line.requisition.id} FOR UPDATE`;
    await lockBanquetItemRows(tx, [line.itemId]);
    // Re-read stock AFTER the lock — a value read before it can be stale.
    const item = await tx.banquetItem.findUnique({
      where: { id: line.itemId },
      select: { currentStock: true, unit: true },
    });
    if (!item) throw new ActionError("Item not found");

    const issueQty = new Decimal(input.issueQty);
    if (issueQty.lte(0)) throw new ActionError("Issue quantity must be greater than 0");
    const remaining = new Decimal(line.requestedQty.toString()).minus(
      new Decimal(line.issuedQty.toString()),
    );
    if (remaining.lte(0)) throw new ActionError("Line is already fully issued");
    if (issueQty.gt(remaining)) {
      throw new ActionError(
        `Only ${remaining.toString()} ${item.unit} still requested on this line — can't issue ${issueQty.toString()}.`,
      );
    }
    const stock = new Decimal(item.currentStock.toString());
    if (issueQty.gt(stock)) {
      throw new ActionError(
        `Only ${stock.toString()} ${item.unit} in stock — issue that or raise a PO for the rest.`,
      );
    }

    // Real stock movement through the shared locked writer (item is locked).
    await writeBanquetIssueLocked(tx, {
      issuedAt: new Date(),
      recordedById: session.user.id,
      purpose: `Requisition ${line.requisition.requisitionNo} · ${line.requisition.createdBy?.name ?? "F&B"}`,
      orderId: line.requisition.orderId,
      notes: null,
      lines: [{ itemId: line.itemId, qty: new Prisma.Decimal(issueQty.toString()) }],
    });

    const newIssued = new Decimal(line.issuedQty.toString()).plus(issueQty);
    const fully = newIssued.gte(new Decimal(line.requestedQty.toString()));
    await tx.banquetRequisitionLine.update({
      where: { id: line.id },
      data: {
        issuedQty: newIssued.toDecimalPlaces(3).toString(),
        status: fully
          ? BanquetRequisitionLineStatus.ISSUED
          : BanquetRequisitionLineStatus.PARTIALLY_ISSUED,
      },
    });

    await recomputeBanquetReqStatus(tx, line.requisition.id, session.user.id);

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_REQUISITION_LINE_ISSUED",
        entity: "BanquetRequisitionLine",
        entityId: line.id,
        payloadHash: sha256Json({ qty: issueQty.toString() }),
      },
    });
    return {
      reqId: line.requisition.id,
      requisitionNo: line.requisition.requisitionNo,
      createdById: line.requisition.createdById,
      itemName: line.item.name,
      unit: item.unit,
      qty: issueQty.toString(),
      issuedSoFar: newIssued.toString(),
      requested: new Decimal(line.requestedQty.toString()).toString(),
      lineFullyIssued: fully,
    };
  });

  // Tell the requester the store acted — mirrors how the chef hears back.
  // Skip self-notifications (F&B roles can issue their own requisitions).
  if (issued.createdById !== session.user.id) {
    const fresh = await db.banquetRequisition.findUnique({
      where: { id: issued.reqId },
      select: { status: true },
    });
    const reqDone = fresh?.status === BanquetRequisitionStatus.FULLY_ISSUED;
    deferAfterResponse("banquet-line-issued:notify", () =>
      createNotification({
        userId: issued.createdById,
        kind: "GENERIC",
        title: reqDone
          ? `${issued.requisitionNo} fully issued — collect from the banquet store`
          : `Store issued ${issued.qty} ${issued.unit} ${issued.itemName}`,
        body: reqDone
          ? undefined
          : `${issued.requisitionNo}: ${issued.issuedSoFar} of ${issued.requested} ${issued.unit} issued so far.`,
        link: `/banquet/requisitions/${issued.reqId}`,
      }),
    );
  }

  revalidatePath("/banquet/requisitions");
  revalidatePath(`/banquet/requisitions/${issued.reqId}`);
  revalidatePath("/banquet/items");
  revalidatePath("/banquet");
  return { ok: true };
}

/**
 * Flag a short requisition line for procurement. The banquet store doesn't buy
 * from vendors itself, and banquet items aren't Ingredients (so they can't
 * pre-fill the ingredient-driven PO form), so — mirroring the old
 * requestGoodsFromStore — this flips the line to AWAITING_PROCUREMENT and
 * routes a HIGH task carrying the item + shortfall to the store keeper (or a
 * manager/admin) to raise the actual PO. Parent status is recomputed.
 */
export async function markBanquetLineAwaitingProcurement(raw: unknown): Promise<ActionResult> {
  try {
    return await markBanquetLineAwaitingProcurementInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function markBanquetLineAwaitingProcurementInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(REQUISITION_ROLES);
  const input = BanquetRequisitionAwaitingInput.parse(raw);

  // Route the "raise a PO" to-do to an active store keeper; fall back to a
  // manager/admin so the request is never dropped.
  const storeKeeper = await db.user.findFirst({
    where: { active: true, role: Role.STORE_KEEPER },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const fallback = storeKeeper
    ? null
    : await db.user.findFirst({
        where: { active: true, role: { in: [Role.MANAGER, Role.ADMIN] } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
  const assigneeId = storeKeeper?.id ?? fallback?.id;

  const result = await db.$transaction(async (tx) => {
    const line = await tx.banquetRequisitionLine.findUnique({
      where: { id: input.requisitionLineId },
      include: {
        requisition: { select: { id: true, status: true, requisitionNo: true, createdById: true } },
        item: { select: { name: true, unit: true } },
      },
    });
    if (!line) throw new ActionError("Requisition line not found");
    if (
      line.status !== BanquetRequisitionLineStatus.PENDING &&
      line.status !== BanquetRequisitionLineStatus.PARTIALLY_ISSUED
    ) {
      throw new ActionError("Only pending or part-issued lines can be sent to procurement");
    }
    if (
      line.requisition.status !== BanquetRequisitionStatus.SUBMITTED &&
      line.requisition.status !== BanquetRequisitionStatus.PARTIALLY_ISSUED
    ) {
      throw new ActionError(
        `Cannot change a ${line.requisition.status.toLowerCase()} requisition`,
      );
    }
    const shortfall = new Decimal(line.requestedQty.toString()).minus(
      new Decimal(line.issuedQty.toString()),
    );
    if (shortfall.lte(0)) throw new ActionError("No shortfall to procure");

    await tx.banquetRequisitionLine.update({
      where: { id: line.id },
      data: {
        status: BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
        notes: input.reason ?? line.notes,
      },
    });

    let taskId: string | null = null;
    if (assigneeId) {
      const shortfallLabel = `${shortfall.toString()} ${line.item.unit} × ${line.item.name}`;
      const task = await tx.task.create({
        data: {
          title: `Raise PO for ${line.item.name} shortfall (${line.requisition.requisitionNo})`,
          description: [
            `Banquet requisition ${line.requisition.requisitionNo} is short: ${shortfallLabel}.`,
            input.reason?.trim() ? `Reason: ${input.reason.trim()}` : null,
            "Raise a purchase order for the shortfall (and record the GRN when goods arrive).",
          ]
            .filter(Boolean)
            .join("\n\n"),
          priority: TaskPriority.HIGH,
          status: TaskStatus.ASSIGNED,
          assignedToId: assigneeId,
          assignedById: session.user.id,
          targetDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        },
      });
      taskId = task.id;
    }

    await recomputeBanquetReqStatus(tx, line.requisition.id, session.user.id);

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_LINE_AWAITING_PROCUREMENT",
        entity: "BanquetRequisitionLine",
        entityId: line.id,
        payloadHash: sha256Json({ shortfall: shortfall.toString(), reason: input.reason ?? null }),
      },
    });
    return {
      reqId: line.requisition.id,
      requisitionNo: line.requisition.requisitionNo,
      createdById: line.requisition.createdById,
      itemName: line.item.name,
      shortfall: shortfall.toString(),
      unit: line.item.unit,
      taskId,
    };
  });

  deferAfterResponse("banquet-line-procure:notify", () =>
    notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
      kind: "TASK_ASSIGNED",
      title: `PO needed for ${result.requisitionNo}`,
      body: `${result.itemName} is short — raise a purchase order for the shortfall.`,
      link: "/procurement/purchase-orders/new",
      dedupeKey: `banquet-line-procure:${input.requisitionLineId}`,
    }),
  );
  // The requester should hear the store's answer, not just management.
  if (result.createdById !== session.user.id) {
    deferAfterResponse("banquet-line-procure:notify-requester", () =>
      createNotification({
        userId: result.createdById,
        kind: "GENERIC",
        title: `${result.itemName} is being procured (${result.requisitionNo})`,
        body: `The store is short ${result.shortfall} ${result.unit} — a purchase has been raised; you'll get it once goods arrive.`,
        link: `/banquet/requisitions/${result.reqId}`,
        dedupeKey: `banquet-line-procure-req:${input.requisitionLineId}`,
      }),
    );
  }

  revalidatePath("/banquet/requisitions");
  revalidatePath(`/banquet/requisitions/${result.reqId}`);
  revalidatePath("/tasks");
  return { ok: true };
}

/**
 * Cancel a non-terminal requisition (ADMIN / MANAGER, or the F&B user who
 * raised it). Cancels every still-open line and closes the header.
 */
export async function cancelBanquetRequisition(id: string, reason: string): Promise<ActionResult> {
  try {
    return await cancelBanquetRequisitionInner(id, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function cancelBanquetRequisitionInner(id: string, reason: string): Promise<{ ok: true }> {
  const session = await requireSession();
  if (!reason?.trim()) throw new ActionError("A cancellation reason is required");

  await db.$transaction(async (tx) => {
    const req = await tx.banquetRequisition.findUnique({
      where: { id },
      select: { status: true, createdById: true },
    });
    if (!req) throw new ActionError("Requisition not found");
    const canCancel =
      session.user.role === Role.ADMIN ||
      session.user.role === Role.MANAGER ||
      req.createdById === session.user.id;
    if (!canCancel) {
      throw new ActionError("You can only cancel requisitions you raised.");
    }
    if (
      req.status === BanquetRequisitionStatus.FULLY_ISSUED ||
      req.status === BanquetRequisitionStatus.CANCELLED
    ) {
      throw new ActionError(`Cannot cancel a ${req.status.toLowerCase()} requisition`);
    }

    await tx.banquetRequisitionLine.updateMany({
      where: {
        requisitionId: id,
        status: {
          in: [
            BanquetRequisitionLineStatus.PENDING,
            BanquetRequisitionLineStatus.PARTIALLY_ISSUED,
            BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
          ],
        },
      },
      data: { status: BanquetRequisitionLineStatus.CANCELLED },
    });
    await tx.banquetRequisition.update({
      where: { id },
      data: { status: BanquetRequisitionStatus.CANCELLED, closedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_REQUISITION_CANCELLED",
        entity: "BanquetRequisition",
        entityId: id,
        payloadHash: sha256Json({ reason: reason.trim() }),
      },
    });
  });

  revalidatePath("/banquet/requisitions");
  revalidatePath(`/banquet/requisitions/${id}`);
  return { ok: true };
}

export async function listBanquetRequisitions(
  opts: { status?: BanquetRequisitionStatus[] } = {},
) {
  await requireRole(READ_ROLES);
  return db.banquetRequisition.findMany({
    where: opts.status ? { status: { in: opts.status } } : {},
    include: {
      order: { select: { id: true, code: true, customer: { select: { name: true } }, eventDate: true } },
      createdBy: { select: { name: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getBanquetRequisition(id: string) {
  await requireRole(READ_ROLES);
  return db.banquetRequisition.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          code: true,
          status: true,
          eventDate: true,
          customer: { select: { id: true, name: true } },
        },
      },
      createdBy: { select: { name: true } },
      lastFulfilledBy: { select: { name: true } },
      lines: {
        include: {
          item: { select: { name: true, sku: true, unit: true, currentStock: true } },
        },
        orderBy: { item: { name: "asc" } },
      },
    },
  });
}
