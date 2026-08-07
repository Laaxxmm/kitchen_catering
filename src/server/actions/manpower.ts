"use server";

import { revalidatePath } from "next/cache";
import { ManpowerRequestStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/server/db";
import { ORDER_MANAGER_ROLES, hasRole, requireRole } from "@/server/rbac";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import { deferAfterResponse } from "@/server/defer";
import { createNotification, notifyRoles } from "@/server/notification-core";
import { sha256Json } from "@/lib/audit";
import { formatINR } from "@/lib/money";
import { manpowerCost, payRefusal, settleRefusal, transitionRefusal } from "@/lib/manpower";
import {
  ManpowerApprovalInput,
  ManpowerPaymentInput,
  ManpowerRequestInput,
  ManpowerSettlementInput,
} from "@/lib/validators";

/**
 * Manpower requests: casual labour hired in for a job, with money attached.
 *
 * This flow NEVER touches Order.status. The client was explicit — "the order
 * doesn't pause, the manpower request keeps flowing in the background". An
 * order is a tag on the request, nothing more.
 *
 * Every transition is a guarded `updateMany` with the expected status in the
 * WHERE clause plus a count check, so two managers clicking Approve at once,
 * or a stale tab, lose the race cleanly instead of double-stamping. The
 * legality of each move and the payment gate live in `@/lib/manpower`, which
 * the UI reads too, so the buttons and the server can't drift apart.
 */

// Who raises one: the chef, the two front-of-house teams, and management.
// Composed from the rbac constants — no new role lists invented here.
const MANPOWER_CREATE_ROLES = [
  ...ORDER_MANAGER_ROLES,
  Role.KITCHEN_HEAD,
  Role.FNB_SERVICE,
  Role.DELIVERY,
];

// Approve / reject / cancel: management only. Approval moves the number the
// business will pay, so it does not go wider than ADMIN + MANAGER.
const MANPOWER_APPROVE_ROLES = ORDER_MANAGER_ROLES;

// Marking the job done: whoever was on site — same set that can raise one.
const MANPOWER_COMPLETE_ROLES = MANPOWER_CREATE_ROLES;

// Settling the real cost and paying it out: the money desk.
const MANPOWER_MONEY_ROLES = [...ORDER_MANAGER_ROLES, Role.ACCOUNTS];

// Anyone who can open an order can see the labour hired for it — same broad
// read set as orders.ts READ_ROLES.
const MANPOWER_READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS,
  Role.DELIVERY, Role.FNB_SERVICE,
];

/** Columns every screen needs. Kept in one place so the board, the order
 *  panel and the monthly report all read the same row shape. */
const REQUEST_SELECT = {
  id: true,
  status: true,
  workDescription: true,
  notes: true,
  orderId: true,
  order: { select: { id: true, code: true, eventDate: true, customer: { select: { name: true } } } },
  requestedPeople: true,
  requestedDays: true,
  requestedRate: true,
  requestedById: true,
  requestedBy: { select: { id: true, name: true } },
  approvedPeople: true,
  approvedDays: true,
  approvedRate: true,
  approvedAt: true,
  approvalNote: true,
  approvedBy: { select: { id: true, name: true } },
  rejectedAt: true,
  rejectionReason: true,
  rejectedBy: { select: { id: true, name: true } },
  completedAt: true,
  completedBy: { select: { id: true, name: true } },
  actualCost: true,
  settledAt: true,
  settledBy: { select: { id: true, name: true } },
  paidAt: true,
  paymentMethod: true,
  paymentReference: true,
  paidBy: { select: { id: true, name: true } },
  cancelledAt: true,
  createdAt: true,
} satisfies Prisma.ManpowerRequestSelect;

export type ManpowerRequestRow = Prisma.ManpowerRequestGetPayload<{
  select: typeof REQUEST_SELECT;
}>;

function requestPath(id: string) {
  return `/manpower/${id}`;
}

/** Every surface a change to one request can show up on. */
function revalidateRequest(orderId: string | null) {
  revalidatePath("/manpower");
  revalidatePath("/dashboard");
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

// ─── Create ──────────────────────────────────────────────────────────────

/**
 * Raise a manpower request. `orderId` null = the standalone route from the
 * home screen; set = raised from inside an order, which only tags the row.
 * The order's own status is deliberately not read and never written.
 */
export async function createManpowerRequest(
  raw: unknown,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(MANPOWER_CREATE_ROLES);
    const input = ManpowerRequestInput.parse(raw);

    let orderLabel: string | null = null;
    if (input.orderId) {
      const order = await db.order.findUnique({
        where: { id: input.orderId },
        select: { code: true },
      });
      if (!order) throw new ActionError("Order not found");
      orderLabel = order.code;
    }

    const created = await db.$transaction(async (tx) => {
      const row = await tx.manpowerRequest.create({
        data: {
          orderId: input.orderId ?? null,
          workDescription: input.workDescription.trim(),
          notes: input.notes?.trim() || null,
          requestedPeople: input.people,
          requestedDays: input.days,
          requestedRate: input.ratePerPersonPerDay,
          requestedById: session.user.id,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MANPOWER_REQUESTED",
          entity: "ManpowerRequest",
          entityId: row.id,
          payloadHash: sha256Json({
            orderId: input.orderId ?? null,
            people: input.people,
            days: input.days,
            rate: input.ratePerPersonPerDay,
          }),
        },
      });
      return row;
    });

    const estimate = manpowerCost(input.people, input.days, input.ratePerPersonPerDay);
    deferAfterResponse("manpower-request:notify", () =>
      notifyRoles(MANPOWER_APPROVE_ROLES, {
        kind: "GENERIC",
        title: "Manpower request awaiting approval",
        body: `${session.user.name ?? "Someone"} asked for ${input.people} × ${input.days} day(s) — ${input.workDescription.trim()}${
          orderLabel ? ` (order ${orderLabel})` : ""
        }. Estimate ${formatINR(estimate)}.`,
        link: requestPath(created.id),
        dedupeKey: `manpower-request:${created.id}`,
      }),
    );

    revalidateRequest(input.orderId ?? null);
    return { ok: true, id: created.id };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Approve / reject ────────────────────────────────────────────────────

/**
 * Approve, optionally editing the count / days / rate first ("the manager can
 * approve, or edit the number required and the cost, then approve").
 *
 * The edit lands in the approved* columns. The requested* columns are never
 * written here — the monthly report needs "asked for 6 at ₹500, approved 4 at
 * ₹450", and an in-place edit would destroy exactly that.
 */
export async function approveManpowerRequest(raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(MANPOWER_APPROVE_ROLES);
    const input = ManpowerApprovalInput.parse(raw);
    const approvedAt = new Date();

    const result = await db.$transaction(async (tx) => {
      const req = await tx.manpowerRequest.findUnique({
        where: { id: input.id },
        select: {
          status: true,
          orderId: true,
          requestedById: true,
          requestedPeople: true,
          requestedDays: true,
          requestedRate: true,
          workDescription: true,
        },
      });
      if (!req) throw new ActionError("That manpower request no longer exists — refresh and try again.");
      const refusal = transitionRefusal(req.status, ManpowerRequestStatus.APPROVED);
      if (refusal) throw new ActionError(refusal);

      // Absent field = "as asked for". Always stamped, so the approved
      // figures are the one place the money reads from afterwards.
      const people = input.people ?? req.requestedPeople;
      const days = input.days ?? req.requestedDays;
      const rate = input.ratePerPersonPerDay ?? req.requestedRate.toString();

      const updated = await tx.manpowerRequest.updateMany({
        where: { id: input.id, status: ManpowerRequestStatus.REQUESTED },
        data: {
          status: ManpowerRequestStatus.APPROVED,
          approvedPeople: people,
          approvedDays: days,
          approvedRate: rate,
          approvedById: session.user.id,
          approvedAt,
          approvalNote: input.note?.trim() || null,
        },
      });
      if (updated.count === 0) {
        throw new ActionError("This request just changed — refresh the page.");
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MANPOWER_APPROVED",
          entity: "ManpowerRequest",
          entityId: input.id,
          payloadHash: sha256Json({
            requested: {
              people: req.requestedPeople,
              days: req.requestedDays,
              rate: req.requestedRate.toString(),
            },
            approved: { people, days, rate },
            note: input.note?.trim() || null,
          }),
        },
      });
      return { ...req, people, days, rate };
    });

    const estimate = manpowerCost(result.people, result.days, result.rate);
    deferAfterResponse("manpower-approved:notify", () =>
      createNotification({
        userId: result.requestedById,
        kind: "GENERIC",
        title: "Manpower request approved",
        body: `${result.workDescription}: ${result.people} people × ${result.days} day(s), ${formatINR(estimate)} approved.`,
        link: requestPath(input.id),
        dedupeKey: `manpower-approved:${input.id}`,
      }),
    );

    revalidateRequest(result.orderId);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/** Turn it down, with a reason the chef can read back. */
export async function rejectManpowerRequest(
  id: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const session = await requireRole(MANPOWER_APPROVE_ROLES);
    const trimmed = reason?.trim() ?? "";
    if (!trimmed) throw new ActionError("Say why the manpower request is being turned down.");
    const rejectedAt = new Date();

    const result = await db.$transaction(async (tx) => {
      const req = await tx.manpowerRequest.findUnique({
        where: { id },
        select: { status: true, orderId: true, requestedById: true, workDescription: true },
      });
      if (!req) throw new ActionError("That manpower request no longer exists — refresh and try again.");
      const refusal = transitionRefusal(req.status, ManpowerRequestStatus.REJECTED);
      if (refusal) throw new ActionError(refusal);

      const updated = await tx.manpowerRequest.updateMany({
        where: { id, status: ManpowerRequestStatus.REQUESTED },
        data: {
          status: ManpowerRequestStatus.REJECTED,
          rejectedById: session.user.id,
          rejectedAt,
          rejectionReason: trimmed,
        },
      });
      if (updated.count === 0) {
        throw new ActionError("This request just changed — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MANPOWER_REJECTED",
          entity: "ManpowerRequest",
          entityId: id,
          payloadHash: sha256Json({ reason: trimmed }),
        },
      });
      return req;
    });

    deferAfterResponse("manpower-rejected:notify", () =>
      createNotification({
        userId: result.requestedById,
        kind: "GENERIC",
        title: "Manpower request turned down",
        body: `${result.workDescription}: ${trimmed}`,
        link: requestPath(id),
        dedupeKey: `manpower-rejected:${id}`,
      }),
    );

    revalidateRequest(result.orderId);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── The job happened ────────────────────────────────────────────────────

/** The labour turned up and the work was done. Money can only move after
 *  this, and only via `settleManpowerCost` → `payManpowerRequest`. */
export async function completeManpowerRequest(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(MANPOWER_COMPLETE_ROLES);
    const completedAt = new Date();

    const orderId = await db.$transaction(async (tx) => {
      const req = await tx.manpowerRequest.findUnique({
        where: { id },
        select: { status: true, orderId: true },
      });
      if (!req) throw new ActionError("That manpower request no longer exists — refresh and try again.");
      const refusal = transitionRefusal(req.status, ManpowerRequestStatus.COMPLETED);
      if (refusal) throw new ActionError(refusal);

      const updated = await tx.manpowerRequest.updateMany({
        where: { id, status: ManpowerRequestStatus.APPROVED },
        data: {
          status: ManpowerRequestStatus.COMPLETED,
          completedById: session.user.id,
          completedAt,
        },
      });
      if (updated.count === 0) {
        throw new ActionError("This request just changed — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MANPOWER_COMPLETED",
          entity: "ManpowerRequest",
          entityId: id,
          payloadHash: sha256Json({ completedAt: completedAt.toISOString() }),
        },
      });
      return req.orderId;
    });

    revalidateRequest(orderId);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Money ───────────────────────────────────────────────────────────────

/**
 * Accounts record what the labour actually invoiced. Not a status move — the
 * request stays COMPLETED — but it is what the payment will be for, so it is
 * gated on the job being done and frozen once paid.
 */
export async function settleManpowerCost(raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(MANPOWER_MONEY_ROLES);
    const input = ManpowerSettlementInput.parse(raw);
    const settledAt = new Date();

    const orderId = await db.$transaction(async (tx) => {
      const req = await tx.manpowerRequest.findUnique({
        where: { id: input.id },
        select: { status: true, orderId: true, actualCost: true },
      });
      if (!req) throw new ActionError("That manpower request no longer exists — refresh and try again.");
      const refusal = settleRefusal(req.status);
      if (refusal) throw new ActionError(refusal);

      // Status guard: a payment landing mid-click loses the race, so a
      // settled figure can never be changed out from under a payment.
      const updated = await tx.manpowerRequest.updateMany({
        where: { id: input.id, status: ManpowerRequestStatus.COMPLETED },
        data: {
          actualCost: input.actualCost,
          settledById: session.user.id,
          settledAt,
        },
      });
      if (updated.count === 0) {
        throw new ActionError("This request just changed — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MANPOWER_COST_SETTLED",
          entity: "ManpowerRequest",
          entityId: input.id,
          payloadHash: sha256Json({
            was: req.actualCost?.toString() ?? null,
            now: input.actualCost,
            note: input.note?.trim() || null,
          }),
        },
      });
      return req.orderId;
    });

    revalidateRequest(orderId);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Pay the labour. The gate is enforced HERE, not just in the UI — approved
 * AND completed AND a settled figure, or nothing leaves. (We found exactly
 * this hole in the supplier-bill flow: the button was hidden, the server
 * still took the call.)
 */
export async function payManpowerRequest(raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(MANPOWER_MONEY_ROLES);
    const input = ManpowerPaymentInput.parse(raw);
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new ActionError("Enter a valid payment date.");

    const orderId = await db.$transaction(async (tx) => {
      const req = await tx.manpowerRequest.findUnique({
        where: { id: input.id },
        select: { status: true, orderId: true, actualCost: true },
      });
      if (!req) throw new ActionError("That manpower request no longer exists — refresh and try again.");
      const refusal = payRefusal(req.status, req.actualCost?.toString() ?? null);
      if (refusal) throw new ActionError(refusal);

      const updated = await tx.manpowerRequest.updateMany({
        where: { id: input.id, status: ManpowerRequestStatus.COMPLETED, actualCost: { not: null } },
        data: {
          status: ManpowerRequestStatus.PAID,
          paidById: session.user.id,
          paidAt,
          paymentMethod: input.method,
          paymentReference: input.reference?.trim() || null,
        },
      });
      if (updated.count === 0) {
        throw new ActionError("This request just changed — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MANPOWER_PAID",
          entity: "ManpowerRequest",
          entityId: input.id,
          payloadHash: sha256Json({
            amount: req.actualCost?.toString() ?? null,
            method: input.method,
            reference: input.reference?.trim() || null,
          }),
        },
      });
      return req.orderId;
    });

    revalidateRequest(orderId);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Cancel ──────────────────────────────────────────────────────────────

/**
 * Call it off. Legal while it is still REQUESTED or APPROVED — i.e. before
 * the labour has worked. Once the job is COMPLETED the debt is real and the
 * only way out is to settle and pay it; correcting the figure is `settle`.
 */
export async function cancelManpowerRequest(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(MANPOWER_CREATE_ROLES);
    const cancelledAt = new Date();

    const orderId = await db.$transaction(async (tx) => {
      const req = await tx.manpowerRequest.findUnique({
        where: { id },
        select: { status: true, orderId: true, requestedById: true },
      });
      if (!req) throw new ActionError("That manpower request no longer exists — refresh and try again.");
      // Management can call anything off; everyone else only their own ask,
      // so a chef withdrawing a mistake doesn't have to chase a manager.
      if (!hasRole(session, MANPOWER_APPROVE_ROLES) && req.requestedById !== session.user.id) {
        throw new ActionError("Only the person who raised this request, or a manager, can cancel it.");
      }
      const refusal = transitionRefusal(req.status, ManpowerRequestStatus.CANCELLED);
      if (refusal) throw new ActionError(refusal);

      const updated = await tx.manpowerRequest.updateMany({
        where: { id, status: req.status },
        data: { status: ManpowerRequestStatus.CANCELLED, cancelledAt },
      });
      if (updated.count === 0) {
        throw new ActionError("This request just changed — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "MANPOWER_CANCELLED",
          entity: "ManpowerRequest",
          entityId: id,
          payloadHash: sha256Json({ from: req.status }),
        },
      });
      return req.orderId;
    });

    revalidateRequest(orderId);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Reads ───────────────────────────────────────────────────────────────

/**
 * The queue. `statuses` absent = everything still live (nothing terminal),
 * which is what an approver's or an accounts board wants by default.
 * `orderId` scopes it to the panel inside one order.
 */
export async function listManpowerRequests(filter?: {
  statuses?: ManpowerRequestStatus[];
  orderId?: string | null;
  /** Only requests this user raised — the chef's "my requests" view. */
  mine?: boolean;
}): Promise<ManpowerRequestRow[]> {
  const session = await requireRole(MANPOWER_READ_ROLES);
  const statuses = filter?.statuses?.length
    ? filter.statuses
    : [
        ManpowerRequestStatus.REQUESTED,
        ManpowerRequestStatus.APPROVED,
        ManpowerRequestStatus.COMPLETED,
      ];
  return db.manpowerRequest.findMany({
    where: {
      status: { in: statuses },
      ...(filter?.orderId !== undefined ? { orderId: filter.orderId } : {}),
      ...(filter?.mine ? { requestedById: session.user.id } : {}),
    },
    select: REQUEST_SELECT,
    orderBy: { createdAt: "desc" },
  });
}

export async function getManpowerRequest(id: string): Promise<ManpowerRequestRow | null> {
  await requireRole(MANPOWER_READ_ROLES);
  return db.manpowerRequest.findUnique({ where: { id }, select: REQUEST_SELECT });
}

/**
 * The report window. `from` inclusive, `to` exclusive, scoped on when the
 * request was raised — the caller picks the month, nothing is hardcoded here.
 * Cancelled and rejected rows are included: "how much manpower was arranged"
 * is only honest next to what was asked for and refused. Filter with
 * `statuses` if the report wants the approved ones alone.
 */
export async function listManpowerRequestsInWindow(
  from: Date,
  to: Date,
  statuses?: ManpowerRequestStatus[],
): Promise<ManpowerRequestRow[]> {
  await requireRole(MANPOWER_READ_ROLES);
  return db.manpowerRequest.findMany({
    where: {
      createdAt: { gte: from, lt: to },
      ...(statuses?.length ? { status: { in: statuses } } : {}),
    },
    select: REQUEST_SELECT,
    orderBy: { createdAt: "asc" },
  });
}
