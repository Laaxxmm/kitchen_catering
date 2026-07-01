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
import {
  BanquetItemInput,
  BanquetIssueInput,
  BanquetReceiptInput,
} from "@/lib/validators";

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
const ISSUE_ROLES = WRITE_ROLES;
const READ_ROLES: Role[] = [...WRITE_ROLES];

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

export async function recordBanquetReceipt(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = BanquetReceiptInput.parse(raw);

  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    qty: new Prisma.Decimal(l.quantity),
    costPerUnit: l.costPerUnit ? new Prisma.Decimal(l.costPerUnit) : null,
  }));
  for (const l of lines) {
    if (l.qty.lessThanOrEqualTo(0)) throw new Error("Quantity must be > 0");
  }

  const receipt = await db.$transaction(async (tx) => {
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
  return { id: receipt.id };
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

export async function recordBanquetIssue(raw: unknown) {
  const session = await requireRole(ISSUE_ROLES);
  const input = BanquetIssueInput.parse(raw);

  const lines = input.lines.map((l) => ({
    itemId: l.itemId,
    qty: new Prisma.Decimal(l.quantity),
  }));
  for (const l of lines) {
    if (l.qty.lessThanOrEqualTo(0)) throw new Error("Quantity must be > 0");
  }

  // Pre-check stock availability.
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const items = await db.banquetItem.findMany({
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

  const issue = await db.$transaction(async (tx) => {
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
  return { id: issue.id };
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
      channel: { in: [OrderChannel.BANQUET, OrderChannel.ODC, OrderChannel.PACKET] },
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
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY]);
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

  await notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
    kind: "TASK_ASSIGNED",
    title: "F&B needs goods procured",
    body: `${summary}. Raise a purchase order (and GRN on receipt).`,
    link: "/procurement/purchase-orders/new",
    dedupeKey: `fnb-store-request:${task.id}`,
  });

  revalidatePath("/banquet");
  revalidatePath("/tasks");
  return { id: task.id };
}
