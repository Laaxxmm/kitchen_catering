"use server";

import { revalidatePath } from "next/cache";
import { DeptPurchaseStatus, Prisma, Role, StoreDepartment } from "@prisma/client";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { db } from "@/server/db";
import { AuthorizationError, requireRole } from "@/server/rbac";
import { istToUtc } from "@/lib/time";
import { sha256Json } from "@/lib/audit";
import { nextDeptPurchaseOrderNumber } from "@/lib/sequences";
import { deferAfterResponse } from "@/server/defer";
import { createNotification, notifyRoles } from "@/server/notification-core";
import {
  DeptPurchaseCreateInput,
  DeptPurchaseDecisionInput,
  DeptPurchaseOrderedInput,
  DeptPurchaseReason,
  DeptPurchaseReceiveInput,
  DeptPurchaseUpdateInput,
} from "@/lib/dept-purchase-validators";
import { ActionError, actionFailure, type ActionResultWith } from "@/server/action-result";

// Housekeeping / maintenance stock requests. One document is both the
// request and the PO: the department head raises it (DRAFT → submit), an
// ADMIN or MANAGER approves it (optionally cutting quantities) or rejects
// it, then the head places it with the supplier and records the goods as
// they arrive, which lands them in the department's own store.
//
// Who can do what:
//   ADMIN / MANAGER       everything, both departments; the only approvers.
//   HOUSEKEEPING_MANAGER  everything except deciding — HOUSEKEEPING only.
//   MAINTENANCE_MANAGER   everything except deciding — MAINTENANCE only.
// Every id-taking action loads the order's department and checks it against
// the caller before anything else; the other department's order reads as
// "not found", exactly like a missing id.

const APPROVER_ROLES: Role[] = [Role.ADMIN, Role.MANAGER];
const PO_ROLES: Role[] = [...APPROVER_ROLES, Role.HOUSEKEEPING_MANAGER, Role.MAINTENANCE_MANAGER];
const DEPT_HEAD: Record<StoreDepartment, Role> = {
  HOUSEKEEPING: Role.HOUSEKEEPING_MANAGER,
  MAINTENANCE: Role.MAINTENANCE_MANAGER,
};
const DEPT_LABEL: Record<StoreDepartment, string> = {
  HOUSEKEEPING: "Housekeeping",
  MAINTENANCE: "Maintenance",
};
const DEPT_SLUG: Record<StoreDepartment, string> = {
  HOUSEKEEPING: "housekeeping",
  MAINTENANCE: "maintenance",
};

const RECEIVABLE: DeptPurchaseStatus[] = ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"];
const CANCELLABLE: DeptPurchaseStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED"];
const NOT_FOUND = "Purchase order not found";
/** estimatedTotal is Decimal(14, 2). */
const TOTAL_CEILING = new Decimal("1e12");

type Tx = Prisma.TransactionClient;

function canActOn(role: Role, department: StoreDepartment): boolean {
  return APPROVER_ROLES.includes(role) || DEPT_HEAD[department] === role;
}

function poLink(department: StoreDepartment, id: string) {
  return `/${DEPT_SLUG[department]}/purchase/${id}`;
}

function refresh(department: StoreDepartment, id?: string) {
  const base = `/${DEPT_SLUG[department]}`;
  revalidatePath(`${base}/purchase`);
  if (id) revalidatePath(`${base}/purchase/${id}`);
  revalidatePath(base);
  revalidatePath("/dashboard");
}

/**
 * The isolation check. Runs before any parsing or writing: an order of the
 * other department, a missing id and a non-string id all read the same.
 */
async function loadForCaller(id: unknown, role: Role) {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) throw new ActionError(NOT_FOUND);
  const po = await db.deptPurchaseOrder.findUnique({
    where: { id },
    select: { id: true, number: true, department: true, status: true, createdById: true, reason: true },
  });
  if (!po || !canActOn(role, po.department)) throw new ActionError(NOT_FOUND);
  return po;
}

function parseDay(raw: string | null): Date | null {
  return raw ? istToUtc(`${raw}T00:00:00`) : null;
}

function by(session: { user: { name?: string | null; email?: string | null } }) {
  return session.user.name ?? session.user.email ?? "someone";
}

/** Row-lock the store items a receipt moves, in a stable order (no deadlocks). */
async function lockItems(tx: Tx, department: StoreDepartment, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    if (department === "HOUSEKEEPING") {
      await tx.$executeRaw`SELECT 1 FROM "HousekeepingItem" WHERE "id" = ${id} FOR UPDATE`;
    } else {
      await tx.$executeRaw`SELECT 1 FROM "MaintenanceItem" WHERE "id" = ${id} FOR UPDATE`;
    }
  }
}

function findItems(tx: Tx, department: StoreDepartment, ids: string[]) {
  const args = {
    where: { id: { in: ids } },
    select: { id: true, name: true, unit: true, active: true },
  };
  return department === "HOUSEKEEPING" ? tx.housekeepingItem.findMany(args) : tx.maintenanceItem.findMany(args);
}

/**
 * Turn requested lines into PO line rows. Every item must be an ACTIVE item
 * of THIS department's store — an id from the other store simply isn't
 * found here. Runs inside the write transaction.
 */
async function buildLines(
  tx: Tx,
  department: StoreDepartment,
  lines: Array<{ itemId: string; quantity: string; rate: string | null }>,
) {
  const items = await findItems(tx, department, lines.map((l) => l.itemId));
  const byId = new Map(items.map((i) => [i.id, i]));
  let total = new Decimal(0);
  const rows = lines.map((l, i) => {
    const it = byId.get(l.itemId);
    if (!it) {
      throw new ActionError(`Line ${i + 1}: that item isn't in the ${DEPT_LABEL[department].toLowerCase()} store`);
    }
    if (!it.active) throw new ActionError(`${it.name} is hidden — unhide it before ordering it`);
    if (l.rate) total = total.plus(new Decimal(l.quantity).times(l.rate));
    return {
      sortOrder: i,
      hkItemId: department === "HOUSEKEEPING" ? it.id : null,
      mtItemId: department === "MAINTENANCE" ? it.id : null,
      itemName: it.name,
      unit: it.unit,
      quantity: l.quantity,
      rate: l.rate,
    };
  });
  if (total.gte(TOTAL_CEILING)) throw new ActionError("The estimated total is too large — check the quantities and rates");
  return { rows, estimatedTotal: total.toDecimalPlaces(2).toString() };
}

// ─── Create / edit / submit ─────────────────────────────────────────────

export async function createDeptPurchaseOrder(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; number: string }>> {
  try {
    const session = await requireRole(PO_ROLES);
    const input = DeptPurchaseCreateInput.parse(raw);
    if (!canActOn(session.user.role, input.department)) {
      throw new ActionError("You can only raise stock requests for your own department");
    }
    const po = await db.$transaction(async (tx) => {
      const { rows, estimatedTotal } = await buildLines(tx, input.department, input.lines);
      const number = await nextDeptPurchaseOrderNumber(tx, input.department);
      const created = await tx.deptPurchaseOrder.create({
        data: {
          number,
          department: input.department,
          reason: input.reason,
          supplierName: input.supplierName,
          supplierPhone: input.supplierPhone,
          expectedAt: parseDay(input.expectedAt),
          notes: input.notes,
          estimatedTotal,
          createdById: session.user.id,
          lines: { create: rows },
        },
        select: { id: true, number: true },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DEPT_PO_CREATED",
          entity: "DeptPurchaseOrder",
          entityId: created.id,
          payloadHash: sha256Json({ ...input, estimatedTotal }),
        },
      });
      return created;
    });
    refresh(input.department, po.id);
    return { ok: true, id: po.id, number: po.number };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function updateDeptPurchaseOrder(id: string, raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(PO_ROLES);
    const po = await loadForCaller(id, session.user.role);
    const input = DeptPurchaseUpdateInput.parse(raw);
    await db.$transaction(async (tx) => {
      const { rows, estimatedTotal } = await buildLines(tx, po.department, input.lines);
      const flipped = await tx.deptPurchaseOrder.updateMany({
        where: { id: po.id, status: "DRAFT" },
        data: {
          reason: input.reason,
          supplierName: input.supplierName,
          supplierPhone: input.supplierPhone,
          expectedAt: parseDay(input.expectedAt),
          notes: input.notes,
          estimatedTotal,
        },
      });
      if (flipped.count !== 1) throw new ActionError("Only a draft can be edited — this one has been submitted");
      await tx.deptPurchaseOrderLine.deleteMany({ where: { poId: po.id } });
      await tx.deptPurchaseOrderLine.createMany({ data: rows.map((r) => ({ ...r, poId: po.id })) });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DEPT_PO_UPDATED",
          entity: "DeptPurchaseOrder",
          entityId: po.id,
          payloadHash: sha256Json({ ...input, estimatedTotal }),
        },
      });
    });
    refresh(po.department, po.id);
    return { ok: true, id: po.id };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function submitDeptPurchaseOrder(id: string): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(PO_ROLES);
    const po = await loadForCaller(id, session.user.role);
    await db.$transaction(async (tx) => {
      const flipped = await tx.deptPurchaseOrder.updateMany({
        where: { id: po.id, status: "DRAFT" },
        data: { status: "PENDING_APPROVAL", submittedAt: new Date() },
      });
      if (flipped.count !== 1) throw new ActionError("Only a draft can be submitted — refresh and try again");
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DEPT_PO_SUBMITTED",
          entity: "DeptPurchaseOrder",
          entityId: po.id,
          payloadHash: sha256Json({ from: "DRAFT", to: "PENDING_APPROVAL" }),
        },
      });
    });
    deferAfterResponse("dept-po:submitted", () =>
      notifyRoles(APPROVER_ROLES, {
        kind: "GENERIC",
        title: `${DEPT_LABEL[po.department]} stock request to approve`,
        body: `${po.number}: ${po.reason} — by ${by(session)}`,
        link: poLink(po.department, po.id),
        dedupeKey: `dept-po-submitted:${po.id}`,
      }),
    );
    refresh(po.department, po.id);
    return { ok: true, id: po.id };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Decide (ADMIN / MANAGER only) ──────────────────────────────────────

export async function decideDeptPurchaseOrder(id: string, raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    // The department heads are refused here even on their own orders —
    // approving your own spend is the one thing this flow exists to stop.
    const session = await requireRole(APPROVER_ROLES);
    const po = await loadForCaller(id, session.user.role);
    const input = DeptPurchaseDecisionInput.parse(raw);
    const now = new Date();

    await db.$transaction(async (tx) => {
      if (input.decision === "REJECT") {
        const flipped = await tx.deptPurchaseOrder.updateMany({
          where: { id: po.id, status: "PENDING_APPROVAL" },
          data: { status: "REJECTED", decidedById: session.user.id, decidedAt: now, decisionNote: input.note },
        });
        if (flipped.count !== 1) throw new ActionError("This request isn't waiting for approval any more — refresh");
      } else {
        const lines = await tx.deptPurchaseOrderLine.findMany({
          where: { poId: po.id },
          select: { id: true, itemName: true, quantity: true, rate: true },
        });
        const cut = new Map((input.lines ?? []).map((l) => [l.lineId, new Decimal(l.approvedQty)]));
        for (const lineId of cut.keys()) {
          if (!lines.some((l) => l.id === lineId)) throw new ActionError("A line on this request has changed — refresh");
        }
        let total = new Decimal(0);
        let anything = false;
        const approved = lines.map((l) => {
          const asked = new Decimal(l.quantity.toString());
          const qty = cut.get(l.id) ?? asked;
          if (qty.gt(asked)) {
            throw new ActionError(`${l.itemName}: you can approve at most the ${asked} asked for`);
          }
          if (qty.gt(0)) anything = true;
          if (l.rate) total = total.plus(qty.times(l.rate.toString()));
          return { id: l.id, qty };
        });
        if (!anything) throw new ActionError("Approve at least one line above 0 — or reject the request");

        const flipped = await tx.deptPurchaseOrder.updateMany({
          where: { id: po.id, status: "PENDING_APPROVAL" },
          data: {
            status: "APPROVED",
            decidedById: session.user.id,
            decidedAt: now,
            decisionNote: input.note,
            estimatedTotal: total.toDecimalPlaces(2).toString(),
          },
        });
        if (flipped.count !== 1) throw new ActionError("This request isn't waiting for approval any more — refresh");
        for (const l of approved) {
          await tx.deptPurchaseOrderLine.update({ where: { id: l.id }, data: { approvedQty: l.qty.toString() } });
        }
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: input.decision === "APPROVE" ? "DEPT_PO_APPROVED" : "DEPT_PO_REJECTED",
          entity: "DeptPurchaseOrder",
          entityId: po.id,
          payloadHash: sha256Json(input),
        },
      });
    });

    if (po.createdById !== session.user.id) {
      const approvedIt = input.decision === "APPROVE";
      deferAfterResponse("dept-po:decided", () =>
        createNotification({
          userId: po.createdById,
          kind: "GENERIC",
          title: approvedIt ? "Stock request approved" : "Stock request rejected",
          body: `${po.number}${input.note ? `: ${input.note}` : ""} — by ${by(session)}`,
          link: poLink(po.department, po.id),
          dedupeKey: `dept-po-decided:${po.id}`,
        }),
      );
    }
    refresh(po.department, po.id);
    return { ok: true, id: po.id };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Order, receive, close ──────────────────────────────────────────────

export async function markDeptPurchaseOrdered(id: string, raw?: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(PO_ROLES);
    const po = await loadForCaller(id, session.user.role);
    const input = DeptPurchaseOrderedInput.parse(raw ?? {});
    await db.$transaction(async (tx) => {
      const current = await tx.deptPurchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        select: { supplierName: true },
      });
      if (!input.supplierName && !current.supplierName) {
        throw new ActionError("Name the supplier the order was placed with");
      }
      const flipped = await tx.deptPurchaseOrder.updateMany({
        where: { id: po.id, status: "APPROVED" },
        data: {
          status: "ORDERED",
          orderedAt: new Date(),
          ...(input.supplierName ? { supplierName: input.supplierName } : {}),
          ...(input.supplierPhone ? { supplierPhone: input.supplierPhone } : {}),
          ...(input.expectedAt ? { expectedAt: parseDay(input.expectedAt) } : {}),
        },
      });
      if (flipped.count !== 1) throw new ActionError("Only an approved order can be marked as placed — refresh");
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DEPT_PO_ORDERED",
          entity: "DeptPurchaseOrder",
          entityId: po.id,
          payloadHash: sha256Json(input),
        },
      });
    });
    refresh(po.department, po.id);
    return { ok: true, id: po.id };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function receiveDeptPurchaseOrder(
  id: string,
  raw: unknown,
): Promise<ActionResultWith<{ id: string; receiptId: string; status: DeptPurchaseStatus }>> {
  try {
    const session = await requireRole(PO_ROLES);
    const po = await loadForCaller(id, session.user.role);
    const input = DeptPurchaseReceiveInput.parse(raw);
    const receivedAt = istToUtc(input.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) throw new ActionError("Enter a valid received date");
    const hk = po.department === "HOUSEKEEPING";

    const out = await db.$transaction(async (tx) => {
      // One receipt at a time per order: the remaining-quantity check below
      // reads receivedQty, and two concurrent receipts would both pass it.
      await tx.$executeRaw`SELECT 1 FROM "DeptPurchaseOrder" WHERE "id" = ${po.id} FOR UPDATE`;
      const order = await tx.deptPurchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        select: {
          status: true,
          supplierName: true,
          lines: {
            select: {
              id: true,
              itemName: true,
              unit: true,
              hkItemId: true,
              mtItemId: true,
              quantity: true,
              approvedQty: true,
              receivedQty: true,
              rate: true,
            },
          },
        },
      });
      if (!RECEIVABLE.includes(order.status)) {
        throw new ActionError("Goods can only be received against an approved or ordered PO");
      }
      const byLine = new Map(order.lines.map((l) => [l.id, l]));
      const approvedOf = (l: (typeof order.lines)[number]) =>
        new Decimal((l.approvedQty ?? l.quantity).toString());

      const moves = input.lines.map((r) => {
        const line = byLine.get(r.lineId);
        if (!line) throw new ActionError("A line on this PO has changed — refresh");
        const itemId = hk ? line.hkItemId : line.mtItemId;
        if (!itemId) throw new ActionError(`${line.itemName} is no longer in the store`);
        const remaining = approvedOf(line).minus(line.receivedQty.toString());
        const qty = new Decimal(r.quantity);
        if (qty.gt(remaining)) {
          throw new ActionError(
            remaining.lte(0)
              ? `${line.itemName} has already been received in full`
              : `${line.itemName}: only ${remaining} ${line.unit} left to receive`,
          );
        }
        return {
          lineId: line.id,
          itemId,
          qty,
          costPerUnit: r.costPerUnit ?? line.rate?.toString() ?? null,
        };
      });

      await lockItems(tx, po.department, moves.map((m) => m.itemId));
      const items = await findItems(tx, po.department, moves.map((m) => m.itemId));
      for (const it of items) {
        if (!it.active) throw new ActionError(`${it.name} is hidden — unhide it before receiving it`);
      }

      const data = {
        receivedAt,
        recordedById: session.user.id,
        sourceNote: input.note ? `${po.number} — ${input.note}` : po.number,
        sourceContact: order.supplierName,
        purchaseOrderId: po.id,
        supplierBillNo: input.supplierBillNo,
        lines: {
          create: moves.map((m) => ({
            itemId: m.itemId,
            quantity: m.qty.toString(),
            costPerUnit: m.costPerUnit,
            poLineId: m.lineId,
          })),
        },
      };
      const receipt = hk
        ? await tx.housekeepingReceipt.create({ data, select: { id: true } })
        : await tx.maintenanceReceipt.create({ data, select: { id: true } });

      for (const m of moves) {
        const stock = { where: { id: m.itemId }, data: { currentStock: { increment: m.qty.toString() } } };
        if (hk) await tx.housekeepingItem.update(stock);
        else await tx.maintenanceItem.update(stock);
        await tx.deptPurchaseOrderLine.update({
          where: { id: m.lineId },
          data: { receivedQty: { increment: m.qty.toString() } },
        });
      }

      const got = new Map(moves.map((m) => [m.lineId, m.qty]));
      const complete = order.lines.every((l) =>
        new Decimal(l.receivedQty.toString()).plus(got.get(l.id) ?? 0).gte(approvedOf(l)),
      );
      const status: DeptPurchaseStatus = complete ? "RECEIVED" : "PARTIALLY_RECEIVED";
      const flipped = await tx.deptPurchaseOrder.updateMany({
        where: { id: po.id, status: { in: RECEIVABLE } },
        data: { status, ...(complete ? { closedAt: new Date() } : {}) },
      });
      if (flipped.count !== 1) throw new ActionError("This PO changed under you — refresh and try again");

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DEPT_PO_RECEIVED",
          entity: "DeptPurchaseOrder",
          entityId: po.id,
          payloadHash: sha256Json({
            receiptId: receipt.id,
            receivedAt: receivedAt.toISOString(),
            supplierBillNo: input.supplierBillNo,
            lines: moves.map((m) => ({ lineId: m.lineId, itemId: m.itemId, qty: m.qty.toString(), costPerUnit: m.costPerUnit })),
            status,
          }),
        },
      });
      return { receiptId: receipt.id, status };
    });

    refresh(po.department, po.id);
    revalidatePath(`/${DEPT_SLUG[po.department]}/items`);
    revalidatePath(`/${DEPT_SLUG[po.department]}/receipts`);
    return { ok: true, id: po.id, ...out };
  } catch (err) {
    return actionFailure(err);
  }
}

/** Part of the order is never coming: stop waiting for it. */
export async function closeDeptPurchaseOrderShort(id: string, note: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(PO_ROLES);
    const po = await loadForCaller(id, session.user.role);
    const reason = DeptPurchaseReason.parse(note);
    await db.$transaction(async (tx) => {
      const current = await tx.deptPurchaseOrder.findUniqueOrThrow({ where: { id: po.id }, select: { notes: true } });
      const flipped = await tx.deptPurchaseOrder.updateMany({
        where: { id: po.id, status: "PARTIALLY_RECEIVED" },
        data: {
          status: "RECEIVED",
          closedAt: new Date(),
          notes: [current.notes, `Closed short: ${reason}`].filter(Boolean).join("\n"),
        },
      });
      if (flipped.count !== 1) throw new ActionError("Only a part-received PO can be closed short — refresh");
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DEPT_PO_CLOSED_SHORT",
          entity: "DeptPurchaseOrder",
          entityId: po.id,
          payloadHash: sha256Json({ reason }),
        },
      });
    });
    refresh(po.department, po.id);
    return { ok: true, id: po.id };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function cancelDeptPurchaseOrder(id: string, reasonRaw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(PO_ROLES);
    const po = await loadForCaller(id, session.user.role);
    const reason = DeptPurchaseReason.parse(reasonRaw);
    await db.$transaction(async (tx) => {
      const current = await tx.deptPurchaseOrder.findUniqueOrThrow({ where: { id: po.id }, select: { notes: true } });
      // Any receipt moves the order out of these statuses, so the guard is
      // also the "nothing received yet" check.
      const flipped = await tx.deptPurchaseOrder.updateMany({
        where: { id: po.id, status: { in: CANCELLABLE } },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          notes: [current.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n"),
        },
      });
      if (flipped.count !== 1) {
        throw new ActionError(
          po.status === "PARTIALLY_RECEIVED" || po.status === "RECEIVED"
            ? "Goods have already been received against this PO — close it short instead"
            : "This PO can't be cancelled any more — refresh",
        );
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DEPT_PO_CANCELLED",
          entity: "DeptPurchaseOrder",
          entityId: po.id,
          payloadHash: sha256Json({ from: po.status, reason }),
        },
      });
    });
    refresh(po.department, po.id);
    return { ok: true, id: po.id };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────

const ListOpts = z.object({
  department: z.nativeEnum(StoreDepartment),
  status: z.array(z.nativeEnum(DeptPurchaseStatus)).optional(),
});

/** Throws (AuthorizationError) for a department the caller doesn't run. */
async function requireDepartment(department: unknown) {
  const session = await requireRole(PO_ROLES);
  const dept = z.nativeEnum(StoreDepartment).parse(department);
  if (!canActOn(session.user.role, dept)) throw new AuthorizationError("Not your department");
  return { session, dept };
}

export async function listDeptPurchaseOrders(opts: { department: StoreDepartment; status?: DeptPurchaseStatus[] }) {
  const { dept } = await requireDepartment(opts?.department);
  const { status } = ListOpts.parse(opts);
  return db.deptPurchaseOrder.findMany({
    where: { department: dept, ...(status?.length ? { status: { in: status } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      number: true,
      status: true,
      reason: true,
      supplierName: true,
      estimatedTotal: true,
      createdAt: true,
      submittedAt: true,
      expectedAt: true,
      createdBy: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });
}

export async function listDeptPurchaseOrdersAwaitingApproval() {
  await requireRole(APPROVER_ROLES);
  return db.deptPurchaseOrder.findMany({
    where: { status: "PENDING_APPROVAL" },
    orderBy: { submittedAt: "asc" },
    take: 100,
    select: {
      id: true,
      number: true,
      department: true,
      reason: true,
      estimatedTotal: true,
      submittedAt: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });
}

/** Active items of the department's own store, for the request form. */
export async function listDeptItemsForPurchase(department: StoreDepartment) {
  const { dept } = await requireDepartment(department);
  const args = {
    where: { active: true },
    orderBy: { name: "asc" as const },
    select: { id: true, name: true, unit: true, currentStock: true, minStock: true },
  };
  return dept === "HOUSEKEEPING" ? db.housekeepingItem.findMany(args) : db.maintenanceItem.findMany(args);
}

const receiptSelect = {
  id: true,
  receivedAt: true,
  supplierBillNo: true,
  sourceNote: true,
  recordedBy: { select: { name: true } },
  lines: { select: { id: true, poLineId: true, quantity: true, costPerUnit: true, item: { select: { name: true, unit: true } } } },
} satisfies Prisma.HousekeepingReceiptSelect;

export async function getDeptPurchaseOrder(id: string) {
  try {
    const session = await requireRole(PO_ROLES);
    const { id: poId } = await loadForCaller(id, session.user.role);
    const po = await db.deptPurchaseOrder.findUniqueOrThrow({
      where: { id: poId },
      include: {
        createdBy: { select: { name: true } },
        decidedBy: { select: { name: true } },
        lines: { orderBy: { sortOrder: "asc" } },
        hkReceipts: { select: receiptSelect, orderBy: { receivedAt: "asc" } },
        mtReceipts: { select: receiptSelect, orderBy: { receivedAt: "asc" } },
      },
    });
    const { hkReceipts, mtReceipts, ...rest } = po;
    return {
      ok: true as const,
      po: { ...rest, receipts: po.department === "HOUSEKEEPING" ? hkReceipts : mtReceipts },
    };
  } catch (err) {
    return actionFailure(err);
  }
}
