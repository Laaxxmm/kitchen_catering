"use server";

import { revalidatePath } from "next/cache";
import { OrderChannel, Prisma, Role, TaskPriority, TaskStatus } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { istToUtc } from "@/lib/time";
import { sha256Json } from "@/lib/audit";
import { INACTIVE_ORDER_STATUSES } from "@/lib/order-status";
import { notifyRoles } from "@/server/actions/notifications";
import { deferAfterResponse } from "@/server/defer";
import {
  BanquetItemInput,
  BanquetIssueInput,
  BanquetReceiptInput,
  BanquetReturnInput,
  BanquetStockCountInput,
} from "@/lib/validators";
import {
  ActionError,
  actionFailure,
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
  const session = await requireRole(WRITE_ROLES);
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

  const itemIds = [...new Set(lines.map((l) => l.itemId))];

  const issue = await db.$transaction(async (tx) => {
    // Check stock availability under the row lock — a pre-check outside the
    // txn could pass for two concurrent issues that together overdraw.
    await lockBanquetItemRows(tx, itemIds);
    const items = await tx.banquetItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, currentStock: true, unit: true, active: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const l of lines) {
      const it = byId.get(l.itemId);
      if (!it) throw new ActionError("Item not found");
      if (!it.active) throw new ActionError(`Item ${it.name} is inactive`);
      if (new Decimal(it.currentStock.toString()).lt(new Decimal(l.qty.toString()))) {
        throw new ActionError(
          `Not enough ${it.name} in stock (have ${it.currentStock.toString()} ${it.unit})`
        );
      }
    }

    const created = await tx.banquetIssue.create({
      data: {
        issuedAt: istToUtc(input.issuedAt),
        recordedById: session.user.id,
        purpose: input.purpose.trim(),
        orderId: input.orderId ?? null,
        notes: input.notes?.trim() || null,
        lines: { create: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty })) },
      },
    });
    for (const l of lines) {
      await tx.banquetItem.update({
        where: { id: l.itemId },
        data: { currentStock: { decrement: l.qty } },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BANQUET_ISSUE_CREATED",
        entity: "BanquetIssue",
        entityId: created.id,
      },
    });
    return created;
  });

  revalidatePath("/banquet/issues");
  revalidatePath("/banquet/items");
  revalidatePath("/banquet");
  return { ok: true, id: issue.id };
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

// ─── Request goods from the store ────────────────────────────────────────
// The F&B Service team doesn't buy from vendors themselves — when they need
// something the banquet store doesn't stock, they ask the STORE KEEPER to
// raise the PO (and GRN on receipt). This routes that ask as a tracked task
// assigned to the store keeper, plus a notification with a "raise a PO" link.
export async function requestGoodsFromStore(input: { summary: string; note?: string }) {
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER]);
  const summary = input.summary?.trim();
  if (!summary || summary.length < 3) throw new Error("Describe what you need (min 3 characters).");

  // Route to an active store keeper; fall back to a manager/admin if the site
  // hasn't set one up, so the request is never dropped.
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
  if (!assigneeId) throw new Error("No store keeper or manager is set up to receive the request.");

  const task = await db.$transaction(async (tx) => {
    const t = await tx.task.create({
      data: {
        title: `Procure for F&B: ${summary.slice(0, 80)}`,
        description: [
          `Requested by ${session.user.name ?? "F&B Service"}.`,
          input.note?.trim() ? input.note.trim() : null,
          "Raise a purchase order for these goods (and record the GRN when they arrive).",
        ]
          .filter(Boolean)
          .join("\n\n"),
        priority: TaskPriority.HIGH,
        status: TaskStatus.ASSIGNED,
        assignedToId: assigneeId,
        assignedById: session.user.id,
        // No explicit due date on a supply request — default to 2 days out so
        // it surfaces with a sensible target the store keeper can adjust.
        targetDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "FNB_STORE_REQUEST_RAISED",
        entity: "Task",
        entityId: t.id,
        payloadHash: sha256Json({ summary }),
      },
    });
    return t;
  });

  deferAfterResponse("fnb-store-request:notify", () =>
    notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
      kind: "TASK_ASSIGNED",
      title: "F&B needs goods procured",
      body: `${summary}. Raise a purchase order (and GRN on receipt).`,
      link: "/procurement/purchase-orders/new",
      dedupeKey: `fnb-store-request:${task.id}`,
    }),
  );

  revalidatePath("/banquet");
  revalidatePath("/tasks");
  return { id: task.id };
}
