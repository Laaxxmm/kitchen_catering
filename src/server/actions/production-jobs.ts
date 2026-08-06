"use server";

import { revalidatePath } from "next/cache";
import {
  OrderChannel,
  OrderStatus,
  ProductionJobItemStatus,
  ProductionJobStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  ORDER_KITCHEN_ROLES,
  ORDER_MANAGER_ROLES,
  requireRole,
  requireSession,
} from "@/server/rbac";
import { ProductionJobItemAssignInput } from "@/lib/validators";
import { nextProductionJobNo } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { formatIST } from "@/lib/time";
import { ActionError, actionFailure, type ActionResult } from "@/server/action-result";
import {
  JOB_ADVANCE_FROM,
  ORDER_ADVANCE_FROM,
  productionCompletion,
} from "@/server/production-completion";
import { deferAfterResponse } from "@/server/defer";
import { createNotification, notifyRoles } from "@/server/notification-core";
import { isImmediateChannel } from "@/lib/order-channels";

const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD, Role.STORE_KEEPER, Role.SALES, Role.ACCOUNTS,
];

/**
 * Internal helper: create the ProductionJob (+ one ProductionJobItem per
 * OrderItem) for an order. Idempotent on order: if a job already exists,
 * does nothing. Called from inside the chef-requisitions transaction once
 * the order auto-advances to READY_FOR_PRODUCTION.
 *
 * Schedules:
 *   scheduledStart = max(now, eventDate - 3h)
 *   scheduledReady = eventDate
 */
export async function createProductionJobForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<string | null> {
  const existing = await tx.productionJob.findFirst({ where: { orderId } });
  if (existing) return existing.id;

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!order) throw new Error("Order not found");
  if (order.items.length === 0) return null;

  const jobNo = await nextProductionJobNo(tx);
  const eventMs = order.eventDate.getTime();
  const startMs = Math.max(Date.now(), eventMs - 3 * 60 * 60 * 1000);

  const job = await tx.productionJob.create({
    data: {
      jobNo,
      orderId,
      status: ProductionJobStatus.QUEUED,
      scheduledStart: new Date(startMs),
      scheduledReady: order.eventDate,
      items: {
        create: order.items.map((it) => ({
          dishId: it.dishId,
          portions: it.portions,
          status: ProductionJobItemStatus.QUEUED,
        })),
      },
    },
  });
  return job.id;
}

export async function assignChef(raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole([...ORDER_MANAGER_ROLES, ...ORDER_KITCHEN_ROLES]);
    const input = ProductionJobItemAssignInput.parse(raw);

    await db.$transaction(async (tx) => {
      const item = await tx.productionJobItem.findUnique({
        where: { id: input.itemId },
        select: { jobId: true },
      });
      if (!item) throw new ActionError("Production item not found");
      await tx.productionJobItem.update({
        where: { id: input.itemId },
        data: { chefUserId: input.chefUserId },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "PRODUCTION_ITEM_ASSIGNED",
          entity: "ProductionJobItem",
          entityId: input.itemId,
          payloadHash: sha256Json({ chefUserId: input.chefUserId }),
        },
      });
    });

    revalidatePath("/kitchen");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function startProductionItem(itemId: string): Promise<ActionResult> {
  try {
    return await startProductionItemInner(itemId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function startProductionItemInner(itemId: string): Promise<{ ok: true }> {
  const session = await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);
  await db.$transaction(async (tx) => {
    const item = await tx.productionJobItem.findUnique({
      where: { id: itemId },
      select: { id: true, status: true, jobId: true, chefUserId: true },
    });
    if (!item) throw new ActionError("Production item not found");
    // Status guard in the WHERE clause: a concurrent double-click loses
    // the race and gets a clear message instead of double-transitioning.
    const updated = await tx.productionJobItem.updateMany({
      where: { id: itemId, status: ProductionJobItemStatus.QUEUED },
      data: {
        status: ProductionJobItemStatus.IN_PROGRESS,
        startedAt: new Date(),
        // Auto-attribute the chef on first "Start" — no manual
        // assignment step. Only set if not already assigned, so re-runs
        // don't overwrite a deliberate prior assignment.
        ...(item.chefUserId ? {} : { chefUserId: session.user.id }),
      },
    });
    if (updated.count === 0) {
      throw new ActionError(
        `Cannot start an item that is ${item.status} — refresh the page.`,
      );
    }

    // If this is the first item in PREP, cascade the parent job. Guarded
    // updateMany rather than findUnique-then-update: two chefs starting two
    // dishes at once must not both write, and the guard also stops the write
    // rewinding a job that already moved past QUEUED.
    await tx.productionJob.updateMany({
      where: { id: item.jobId, status: ProductionJobStatus.QUEUED },
      data: { status: ProductionJobStatus.PREP },
    });
    await tx.productionJob.updateMany({
      where: { id: item.jobId, actualStart: null },
      data: { actualStart: new Date() },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PRODUCTION_ITEM_STARTED",
        entity: "ProductionJobItem",
        entityId: itemId,
      },
    });
  });
  revalidatePath("/kitchen");
  return { ok: true };
}

// ─── In-house "cooked — ready to serve" ping ───────────────────────────────
// IMMEDIATE channels (room service / à la carte / management) are served on
// the premises with NO driver dispatch step, so the delivery "ready to
// dispatch" fan-out never fires for them. Instead, when cooking completes
// (order → READY), the F&B team who raised it needs a "cooked — ready to
// serve" nudge. This is mutually exclusive with scheduleHandoverNotify:
// dispatch/handover is only reachable for event-delivery channels (the chef
// work-screen shows the HandoverChecklist / handToDelivery only when
// !isImmediateChannel), so a given order fires exactly one of the two.

/** Everything the post-commit "cooked — ready to serve" ping needs. */
interface CookedServePayload {
  orderId: string;
  code: string;
  roomNumber: string | null;
  tableNumber: string | null;
  createdById: string;
  customerName: string;
}

/**
 * Inside the caller's tx, right after a guarded order→READY flip actually
 * fired (count > 0): return the ping payload iff the order is an in-house
 * IMMEDIATE channel. Event-delivery channels get the dispatch fan-out at
 * handover instead, so this returns null for them — keeping the two
 * notifications mutually exclusive per order.
 */
async function collectCookedServe(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<CookedServePayload | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, code: true, channel: true, roomNumber: true, tableNumber: true,
      createdById: true, customer: { select: { name: true } },
    },
  });
  if (!order || !isImmediateChannel(order.channel)) return null;
  return {
    orderId: order.id,
    code: order.code,
    roomNumber: order.roomNumber,
    tableNumber: order.tableNumber,
    createdById: order.createdById,
    customerName: order.customer.name,
  };
}

/**
 * Post-commit fan-out for an in-house order that's just been cooked. Pings the
 * F&B team (DELIVERY + retired FNB_SERVICE alias) plus whoever raised it, once
 * each (dedupeKey), so they carry it to the room/table. No driver step here.
 */
function notifyImmediateOrderCooked(n: CookedServePayload): void {
  const where = n.roomNumber
    ? ` · Room ${n.roomNumber}`
    : n.tableNumber
      ? ` · Table ${n.tableNumber}`
      : "";
  const payload = {
    kind: "GENERIC" as const,
    title: `Order ${n.code} is cooked — ready to serve`,
    body: `${n.customerName}${where} — cooked and ready to serve.`,
    link: `/orders/${n.orderId}`,
    dedupeKey: `order-cooked-serve:${n.orderId}`,
  };
  deferAfterResponse("order-cooked:notify", async () => {
    await notifyRoles([Role.DELIVERY, Role.FNB_SERVICE], payload);
    // The specific person who raised it. dedupeKey (@@unique userId+dedupeKey)
    // means no double if they're also a DELIVERY/FNB_SERVICE user.
    if (n.createdById) await createNotification({ userId: n.createdById, ...payload });
  });
}

// ─── Completion sync (the self-healing core) ──────────────────────────────

interface CompletionSync {
  orderId: string;
  /** THIS call performed the order flip — so it owns the audit + notify. */
  orderAdvanced: boolean;
  cooked: CookedServePayload | null;
}

/**
 * Re-derive "this job is finished" from the ACTUAL item rows and advance the
 * job and the order with two INDEPENDENT guarded writes.
 *
 * This is deliberately not conditional on anything the caller just did. If a
 * previous click flipped the job but not the order (the ORD-26-27-0085 bug —
 * the order cascade used to be nested inside `jobUpdated.count > 0`, so a job
 * that was already READY skipped it silently), the next call to this function
 * from ANY path finishes the job off. Stuck orders clear themselves.
 *
 * Both writes stay guarded `updateMany` + count check, so two chefs tapping at
 * once still can't double-transition, and neither write can rewind a status or
 * resurrect a job/order that was cancelled (CANCELLED is in neither
 * *_ADVANCE_FROM list).
 */
async function syncJobAndOrderCompletion(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<CompletionSync> {
  const job = await tx.productionJob.findUnique({
    where: { id: jobId },
    select: {
      orderId: true,
      status: true,
      items: { select: { status: true } },
      order: { select: { status: true } },
    },
  });
  if (!job) return { orderId: "", orderAdvanced: false, cooked: null };

  const decision = productionCompletion(
    job.items.map((it) => it.status),
    job.status,
    job.order.status,
  );

  if (decision.advanceJob) {
    await tx.productionJob.updateMany({
      where: { id: jobId, status: { in: JOB_ADVANCE_FROM } },
      data: { status: ProductionJobStatus.READY, actualReady: new Date() },
    });
  }

  if (!decision.advanceOrder) {
    return { orderId: job.orderId, orderAdvanced: false, cooked: null };
  }

  const orderFlip = await tx.order.updateMany({
    where: { id: job.orderId, status: { in: ORDER_ADVANCE_FROM } },
    data: { status: OrderStatus.READY },
  });
  // count 0 = a concurrent tap advanced it in the same instant. The order is
  // READY either way; that call owns the audit + notification, not this one.
  return {
    orderId: job.orderId,
    orderAdvanced: orderFlip.count > 0,
    cooked: orderFlip.count > 0 ? await collectCookedServe(tx, job.orderId) : null,
  };
}

/**
 * Manual "finish this job off" — the kitchen board's one-tap fix for a job
 * that reads READY while its order hasn't caught up, and the recovery path
 * `handToDelivery` calls before it refuses. Runs exactly the same sync the
 * automatic paths run, so it can never do something they couldn't.
 *
 * Returns `{ok:true}` when the order IS at READY afterwards, and a readable
 * `{ok:false,error}` when it genuinely can't get there — never a silent no-op.
 */
export async function syncProductionJobCompletion(jobId: string): Promise<ActionResult> {
  try {
    const session = await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);

    // Return the outcome OUT of the transaction rather than assigning to
    // captured `let`s — keeps the post-commit branching honest.
    const out = await db.$transaction(async (tx) => {
      const job = await tx.productionJob.findUnique({
        where: { id: jobId },
        select: {
          orderId: true,
          items: { select: { status: true } },
          order: { select: { code: true } },
        },
      });
      if (!job) throw new ActionError("Production job not found");
      const live = job.items.filter((it) => it.status !== ProductionJobItemStatus.CANCELLED);

      const sync = await syncJobAndOrderCompletion(tx, jobId);
      if (sync.orderAdvanced) {
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: "ORDER_MARKED_READY",
            entity: "Order",
            entityId: job.orderId,
          },
        });
      }
      const after = await tx.order.findUnique({
        where: { id: job.orderId },
        select: { status: true },
      });
      return {
        sync,
        orderId: job.orderId,
        orderCode: job.order.code,
        orderStatus: after?.status ?? null,
        itemsTotal: live.length,
        itemsReady: live.filter((it) => it.status === ProductionJobItemStatus.READY).length,
      };
    });

    if (out.sync.cooked) notifyImmediateOrderCooked(out.sync.cooked);
    revalidatePath("/dashboard");
    revalidatePath("/kitchen");
    revalidatePath("/orders");
    revalidatePath(`/orders/${out.orderId}`);

    if (out.orderStatus === OrderStatus.READY) return { ok: true };
    if (out.itemsTotal === 0) {
      return {
        ok: false,
        error: `Order ${out.orderCode} has no dishes left to cook — nothing to send to dispatch.`,
      };
    }
    if (out.itemsReady < out.itemsTotal) {
      return {
        ok: false,
        error: `${out.itemsTotal - out.itemsReady} of ${out.itemsTotal} dishes still cooking — mark them ready first.`,
      };
    }
    return {
      ok: false,
      error: `Order ${out.orderCode} is ${out.orderStatus ?? "missing"} — the kitchen can't advance it from here. Ask a manager.`,
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function markProductionItemReady(itemId: string): Promise<ActionResult> {
  try {
    return await markProductionItemReadyInner(itemId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function markProductionItemReadyInner(itemId: string): Promise<{ ok: true }> {
  const session = await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);
  let cooked: CookedServePayload | null = null;
  await db.$transaction(async (tx) => {
    const item = await tx.productionJobItem.findUnique({
      where: { id: itemId },
      select: { jobId: true },
    });
    if (!item) throw new ActionError("Production item not found");

    // Guarded transition: only a live (QUEUED / IN_PROGRESS) item can be
    // marked ready. A concurrent double-tap (already READY) or a CANCELLED
    // item — e.g. an item on a job whose order was cancelled — matches zero
    // rows, so a stale kitchen tap can't resurrect a cancelled order.
    const updated = await tx.productionJobItem.updateMany({
      where: {
        id: itemId,
        status: { in: [ProductionJobItemStatus.QUEUED, ProductionJobItemStatus.IN_PROGRESS] },
      },
      data: { status: ProductionJobItemStatus.READY, readyAt: new Date() },
    });
    if (updated.count > 0) {
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "PRODUCTION_ITEM_READY",
          entity: "ProductionJobItem",
          entityId: itemId,
        },
      });
    }

    // Runs whether or not this click changed the item. A double-tap, a
    // retried request or an item that was already READY still re-checks the
    // real condition and advances anything left behind — that is the
    // self-healing property, and dropping it is what stranded the order.
    const sync = await syncJobAndOrderCompletion(tx, item.jobId);
    if (sync.orderAdvanced) {
      cooked = sync.cooked;
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ORDER_MARKED_READY",
          entity: "Order",
          entityId: sync.orderId,
        },
      });
    }
  });
  if (cooked) notifyImmediateOrderCooked(cooked);
  // /dashboard too: this path can advance the ORDER, and the chef work-screen
  // there is the other half of the two screens that used to disagree.
  revalidatePath("/dashboard");
  revalidatePath("/kitchen");
  revalidatePath("/orders");
  return { ok: true };
}

// ─── Kitchen → delivery handover (per dish) ────────────────────────────────
// Each dish is ticked "Handed over" at the moment it's physically given to
// the delivery team (timestamp + who). The ORDER-level handover
// (handedToDeliveryAt) completes automatically when the LAST item is ticked
// — so a late fifth dish is attributable to the kitchen, not the driver.

// Both sides of the counter may tap the tick — kitchen hands, delivery/F&B
// receives; handedOverById records who actually did.
const HANDOVER_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD, Role.DELIVERY, Role.FNB_SERVICE,
];

/** Everything the post-commit "ready to dispatch" notification needs. */
interface HandoverNotifyPayload {
  orderId: string;
  code: string;
  channel: OrderChannel;
  roomNumber: string | null;
  customerName: string;
}

/**
 * Inside the caller's transaction: if every live (non-cancelled) item of the
 * job is now handed over, stamp the order's handedToDeliveryAt — the exact
 * side-effects of the legacy order-level hand-off in
 * `@/server/actions/deliveries` (guarded stamp + ORDER_HANDED_TO_DELIVERY
 * audit). Returns the notification payload when this call performed the
 * stamp, so the caller can defer the SAME "ready to dispatch" fan-out after
 * commit (dedupeKey `order-ready-dispatch:<orderId>` keeps it to one
 * notification per user however many paths fire).
 */
async function completeOrderHandoverIfAllHanded(
  tx: Prisma.TransactionClient,
  jobId: string,
  userId: string,
): Promise<HandoverNotifyPayload | null> {
  const job = await tx.productionJob.findUnique({
    where: { id: jobId },
    select: {
      orderId: true,
      items: { select: { status: true, handedOverAt: true } },
      order: {
        select: {
          id: true, code: true, channel: true, roomNumber: true,
          handedToDeliveryAt: true,
          customer: { select: { name: true } },
        },
      },
    },
  });
  if (!job) return null;
  const live = job.items.filter((it) => it.status !== ProductionJobItemStatus.CANCELLED);
  // Not everything is out of the kitchen yet — a normal partial tick, not a
  // failure. The order-level stamp lands when the last dish is ticked.
  if (live.length === 0 || live.some((it) => !it.handedOverAt)) return null;

  // Everything has physically left the counter, so every dish is READY by
  // definition (markItemHandedOver refuses otherwise). If the order hasn't
  // caught up to READY, bring it up FIRST — otherwise the guarded stamp below
  // matches zero rows and the chef is told nothing while the order rots.
  await syncJobAndOrderCompletion(tx, jobId);
  // (Only event-delivery channels reach handover — the chef screen hides it
  // for in-house channels — so the "cooked, ready to serve" ping that sync can
  // return is null here by construction and nothing is dropped.)

  // Guarded stamp — mirrors handToDelivery: only a READY order that hasn't
  // been stamped yet. A concurrent tap matches zero rows and skips the
  // audit + notify.
  const updated = await tx.order.updateMany({
    where: { id: job.orderId, status: OrderStatus.READY, handedToDeliveryAt: null },
    data: { handedToDeliveryAt: new Date() },
  });
  if (updated.count === 0) {
    const now = await tx.order.findUnique({
      where: { id: job.orderId },
      select: { status: true, handedToDeliveryAt: true },
    });
    // Already stamped (double-tap, or a sibling path won the race) — the
    // handover really is complete, so this is a genuine no-op.
    if (now?.handedToDeliveryAt) return null;
    // Otherwise it failed for a reason the chef must see, not a silent null.
    // The whole transaction rolls back, so this tick was NOT recorded.
    throw new ActionError(
      `Every dish on ${job.order.code} is handed over, but the order is ${now?.status ?? "missing"} and can't be sent to dispatch — nothing was recorded. Refresh, or ask a manager.`,
    );
  }
  await tx.auditLog.create({
    data: {
      userId,
      action: "ORDER_HANDED_TO_DELIVERY",
      entity: "Order",
      entityId: job.orderId,
    },
  });
  return {
    orderId: job.orderId,
    code: job.order.code,
    channel: job.order.channel,
    roomNumber: job.order.roomNumber,
    customerName: job.order.customer.name,
  };
}

/**
 * Post-commit fan-out for a completed order handover. Identical payload +
 * dedupeKey to the legacy handToDelivery notification, so whichever path
 * completes the handover, the delivery/manager team is pinged exactly once.
 */
function scheduleHandoverNotify(n: HandoverNotifyPayload): void {
  const where = n.roomNumber ? ` · Room ${n.roomNumber}` : "";
  // Drivers can't open /deliveries/new (admin/manager page) — their link
  // goes to the work screen instead (AUDIT_REPORT M15).
  const payload = {
    kind: "GENERIC" as const,
    title: `Order ${n.code} ready to dispatch`,
    body: `${n.customerName} · ${n.channel}${where}. Cooked and ready — schedule the delivery.`,
    dedupeKey: `order-ready-dispatch:${n.orderId}`,
  };
  deferAfterResponse("hand-to-delivery:notify", async () => {
    await notifyRoles([Role.ADMIN, Role.MANAGER], {
      ...payload,
      link: `/deliveries/new?orderId=${n.orderId}`,
    });
    await notifyRoles([Role.DELIVERY], { ...payload, link: "/dashboard" });
  });
}

function revalidateHandoverPaths(orderId: string): void {
  revalidatePath("/dashboard");
  revalidatePath("/kitchen");
  revalidatePath("/deliveries");
  revalidatePath(`/orders/${orderId}`);
}

/**
 * Tick one dish "Handed over" at the moment it's physically given to the
 * delivery team. Stamps who + when on the item; when this was the LAST
 * un-handed item of the job, the order-level handover completes in the same
 * transaction (handedToDeliveryAt + audit + the one deferred notification).
 */
export async function markItemHandedOver(
  productionJobItemId: string,
): Promise<ActionResult> {
  try {
    return await markItemHandedOverInner(productionJobItemId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function markItemHandedOverInner(itemId: string): Promise<{ ok: true }> {
  const session = await requireRole(HANDOVER_ROLES);
  let orderId = "";
  let notify: HandoverNotifyPayload | null = null;
  await db.$transaction(async (tx) => {
    const item = await tx.productionJobItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        status: true,
        jobId: true,
        handedOverAt: true,
        dish: { select: { name: true } },
        handedOverBy: { select: { name: true } },
        job: { select: { orderId: true, order: { select: { code: true } } } },
      },
    });
    if (!item) throw new ActionError("Production item not found");
    orderId = item.job.orderId;
    if (item.handedOverAt) {
      // Friendly refusal, not a crash — a stale card / double-tap just
      // learns when and by whom it already went out.
      throw new ActionError(
        `Already handed over at ${formatIST(item.handedOverAt, "HH:mm")} by ${item.handedOverBy?.name ?? "someone"}`,
      );
    }
    if (item.status !== ProductionJobItemStatus.READY) {
      throw new ActionError("Cook and mark this dish ready before handing it over");
    }
    // Guarded write: a concurrent tap that already stamped it matches zero
    // rows — the loser gets the friendly message instead of double-writing.
    const updated = await tx.productionJobItem.updateMany({
      where: { id: itemId, handedOverAt: null },
      data: { handedOverAt: new Date(), handedOverById: session.user.id },
    });
    if (updated.count === 0) {
      throw new ActionError("This dish was just handed over — refresh the page.");
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PRODUCTION_ITEM_HANDED_OVER",
        entity: "ProductionJobItem",
        entityId: itemId,
        payloadHash: sha256Json({ dish: item.dish.name, orderCode: item.job.order.code }),
      },
    });
    notify = await completeOrderHandoverIfAllHanded(tx, item.jobId, session.user.id);
  });
  if (notify) scheduleHandoverNotify(notify);
  revalidateHandoverPaths(orderId);
  return { ok: true };
}

/**
 * Convenience: everything goes out together. Stamps every un-handed READY
 * item of the job with ONE timestamp and completes the order handover.
 * Refuses while any live dish is still cooking; a re-tap with everything
 * already handed is a harmless no-op.
 */
export async function markAllItemsHandedOver(jobId: string): Promise<ActionResult> {
  try {
    return await markAllItemsHandedOverInner(jobId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function markAllItemsHandedOverInner(jobId: string): Promise<{ ok: true }> {
  const session = await requireRole(HANDOVER_ROLES);
  let orderId = "";
  let notify: HandoverNotifyPayload | null = null;
  await db.$transaction(async (tx) => {
    const job = await tx.productionJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        orderId: true,
        order: { select: { code: true } },
        items: {
          select: {
            id: true, status: true, handedOverAt: true,
            dish: { select: { name: true } },
          },
        },
      },
    });
    if (!job) throw new ActionError("Production job not found");
    orderId = job.orderId;
    const live = job.items.filter((it) => it.status !== ProductionJobItemStatus.CANCELLED);
    const unhanded = live.filter((it) => !it.handedOverAt);
    if (unhanded.length > 0) {
      const notReady = unhanded.filter((it) => it.status !== ProductionJobItemStatus.READY);
      if (notReady.length > 0) {
        throw new ActionError(
          notReady.length === 1
            ? `${notReady[0].dish.name} isn't ready yet — cook and mark it ready before handing it over.`
            : `${notReady.length} dishes aren't ready yet — cook and mark them ready before handing over.`,
        );
      }
      // One timestamp for the whole batch — they left the counter together.
      const ts = new Date();
      const updated = await tx.productionJobItem.updateMany({
        where: { jobId, status: ProductionJobItemStatus.READY, handedOverAt: null },
        data: { handedOverAt: ts, handedOverById: session.user.id },
      });
      if (updated.count > 0) {
        await tx.auditLog.createMany({
          data: unhanded.map((it) => ({
            userId: session.user.id,
            action: "PRODUCTION_ITEM_HANDED_OVER",
            entity: "ProductionJobItem",
            entityId: it.id,
            payloadHash: sha256Json({ dish: it.dish.name, orderCode: job.order.code }),
          })),
        });
      }
    }
    // Everything is handed now (or already was) — complete the order-level
    // handover if it hasn't been stamped yet.
    notify = await completeOrderHandoverIfAllHanded(tx, jobId, session.user.id);
  });
  if (notify) scheduleHandoverNotify(notify);
  revalidateHandoverPaths(orderId);
  return { ok: true };
}

// ─── Order-level convenience actions (chef work-screen) ────────────────────
// One-tap wrappers so the chef can drive the whole order from their
// dashboard without touching the per-item kitchen board.

/**
 * "Start cooking" — order READY_FOR_PRODUCTION → IN_PREP. Ensures a
 * production job exists, marks every item IN_PROGRESS, and advances the
 * order. Idempotent-ish: safe to re-run while already IN_PREP.
 */
export async function startCookingOrder(orderId: string): Promise<ActionResult> {
  try {
    return await startCookingOrderInner(orderId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function startCookingOrderInner(orderId: string): Promise<{ ok: true }> {
  const session = await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);
  await db.$transaction(async (tx) => {
    // Status guard in the WHERE clause: two chefs tapping at once can't
    // both transition the order — the loser gets count 0 and a clear
    // message. (IN_PREP is allowed so a re-run stays a safe no-op-ish.)
    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        status: { in: [OrderStatus.READY_FOR_PRODUCTION, OrderStatus.IN_PREP] },
      },
      data: { status: OrderStatus.IN_PREP },
    });
    if (updated.count === 0) {
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (!order) throw new ActionError("Order not found");
      throw new ActionError(
        `Cannot start cooking from status ${order.status} — refresh the page.`,
      );
    }
    const jobId = await createProductionJobForOrder(tx, orderId);
    if (jobId) {
      await tx.productionJobItem.updateMany({
        where: { jobId, status: ProductionJobItemStatus.QUEUED },
        data: { status: ProductionJobItemStatus.IN_PROGRESS, startedAt: new Date() },
      });
      // Guarded: a plain update here would rewind a COOKING/READY job back to
      // PREP (and reset actualStart) on a re-tap of "Start cooking".
      await tx.productionJob.updateMany({
        where: { id: jobId, status: ProductionJobStatus.QUEUED },
        data: { status: ProductionJobStatus.PREP },
      });
      await tx.productionJob.updateMany({
        where: { id: jobId, actualStart: null },
        data: { actualStart: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_COOKING_STARTED",
        entity: "Order",
        entityId: orderId,
      },
    });
  });
  revalidatePath("/dashboard");
  revalidatePath("/kitchen");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

/**
 * "Mark cooked / ready" — order IN_PREP (or READY_FOR_PRODUCTION) → READY.
 * Marks every production item READY, the job READY, and advances the order
 * so the delivery team can dispatch.
 */
export async function markOrderCooked(orderId: string): Promise<ActionResult> {
  try {
    return await markOrderCookedInner(orderId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function markOrderCookedInner(orderId: string): Promise<{ ok: true }> {
  const session = await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);
  let cooked: CookedServePayload | null = null;
  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!order) throw new ActionError("Order not found");
    // READY is ACCEPTED here, not rejected. An order that already advanced
    // while its job/items lagged behind must still be finishable from this
    // button; the old code threw "Cannot mark ready from status READY" and
    // left the kitchen with no way to reconcile the two screens.
    if (
      !ORDER_ADVANCE_FROM.includes(order.status) &&
      order.status !== OrderStatus.READY
    ) {
      throw new ActionError(
        `Cannot mark ready from status ${order.status} — refresh the page.`,
      );
    }

    const job = await tx.productionJob.findFirst({
      where: { orderId },
      select: { id: true },
    });
    if (job) {
      // Only live, not-yet-ready dishes: re-running must not overwrite an
      // existing readyAt, and must not resurrect a cancelled dish.
      await tx.productionJobItem.updateMany({
        where: {
          jobId: job.id,
          status: {
            in: [ProductionJobItemStatus.QUEUED, ProductionJobItemStatus.IN_PROGRESS],
          },
        },
        data: { status: ProductionJobItemStatus.READY, readyAt: new Date() },
      });
      // Job and order each advance through their own guarded write — the job
      // flip is no longer a precondition for the order flip.
      const sync = await syncJobAndOrderCompletion(tx, job.id);
      cooked = sync.cooked;
      if (!sync.orderAdvanced) {
        const after = await tx.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        // READY = an idempotent re-tap, nothing new to log. Anything else
        // means there was nothing cookable here — don't report success.
        if (after?.status !== OrderStatus.READY) {
          throw new ActionError(
            "Every dish on this order is cancelled — there's nothing to mark ready.",
          );
        }
        return;
      }
    } else {
      // Legacy order with no production job: flip it directly, still guarded.
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: { in: ORDER_ADVANCE_FROM } },
        data: { status: OrderStatus.READY },
      });
      if (updated.count === 0) return; // lost the race / already READY.
      cooked = await collectCookedServe(tx, orderId);
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_MARKED_READY",
        entity: "Order",
        entityId: orderId,
      },
    });
  });
  if (cooked) notifyImmediateOrderCooked(cooked);
  revalidatePath("/dashboard");
  revalidatePath("/kitchen");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

/**
 * Orders the chef needs to act on, in pipeline order. Powers the chef
 * work-screen on the dashboard. Returns a flat list with the single
 * "next action" each order is waiting for.
 *
 * `window` optionally limits the board to orders whose EVENT DATE falls in
 * the half-open [from, toExclusive) range — resolve IST day boundaries with
 * the helpers in @/lib/time (istScopeWindow etc.) before passing.
 */
export async function listChefBoardOrders(
  window?: { from?: Date; toExclusive?: Date },
) {
  await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);
  const orders = await db.order.findMany({
    where: {
      status: {
        in: [
          OrderStatus.PENDING_CHEF_APPROVAL,
          OrderStatus.CHEF_REQUISITION_PENDING,
          OrderStatus.ISSUING,
          OrderStatus.READY_FOR_PRODUCTION,
          OrderStatus.IN_PREP,
          OrderStatus.READY,
        ],
      },
      ...(window?.from || window?.toExclusive
        ? {
            eventDate: {
              ...(window.from ? { gte: window.from } : {}),
              ...(window.toExclusive ? { lt: window.toExclusive } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      code: true,
      status: true,
      channel: true,
      headcount: true,
      eventDate: true,
      deliveryWindowStart: true,
      deliveryWindowEnd: true,
      roomNumber: true,
      tableNumber: true,
      handedToDeliveryAt: true,
      customer: { select: { name: true } },
      items: { select: { id: true, portions: true, dish: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
      // Per-dish handover state for the READY-tab checklist. Lean: just
      // what the HandoverChecklist needs (an order has at most one job).
      productionJobs: {
        select: {
          id: true,
          items: {
            select: {
              id: true,
              status: true,
              portions: true,
              handedOverAt: true,
              dish: { select: { name: true } },
              handedOverBy: { select: { name: true } },
            },
          },
        },
        take: 1,
      },
    },
    orderBy: [{ eventDate: "asc" }],
    take: 100,
  });
  return orders;
}

// ─── Queries ─────────────────────────────────────────────────────────────

/**
 * `window` optionally limits jobs to those whose ORDER's event date falls in
 * the half-open [from, toExclusive) range. Callers resolve IST day
 * boundaries via @/lib/time (istScopeWindow etc.) — the old string window
 * ("today" | "tomorrow" | "thisweek") used server-local midnight, which
 * drifted from the IST calendar day whenever the host wasn't in IST.
 */
export async function listProductionJobs(
  opts: { window?: { from?: Date; toExclusive?: Date } } = {},
) {
  await requireRole(READ_ROLES);

  const win = opts.window;
  return db.productionJob.findMany({
    where: {
      status: { not: ProductionJobStatus.CANCELLED },
      // Only show jobs whose order is still in a kitchen-relevant state.
      // Once an order is handed to delivery / delivered / invoiced, its job
      // would otherwise linger here forever as a stale READY card — and
      // tapping "Send to dispatch" on it throws (order no longer READY).
      order: {
        status: {
          in: [
            OrderStatus.READY_FOR_PRODUCTION,
            OrderStatus.IN_PREP,
            OrderStatus.READY,
          ],
        },
        ...(win?.from || win?.toExclusive
          ? {
              eventDate: {
                ...(win.from ? { gte: win.from } : {}),
                ...(win.toExclusive ? { lt: win.toExclusive } : {}),
              },
            }
          : {}),
      },
    },
    include: {
      order: {
        select: {
          id: true, code: true, eventDate: true, channel: true, handedToDeliveryAt: true,
          // The board compares this against the JOB status to spot a job that
          // finished while its order was left behind.
          status: true,
          customer: { select: { name: true } },
        },
      },
      items: {
        include: {
          dish: { select: { name: true } },
          chef: { select: { name: true } },
          handedOverBy: { select: { name: true } },
        },
      },
    },
    orderBy: { scheduledReady: "asc" },
    take: 200,
  });
}

export async function getProductionJob(id: string) {
  await requireSession();
  return db.productionJob.findUnique({
    where: { id },
    include: {
      order: { select: { id: true, code: true, eventDate: true, customer: { select: { name: true } } } },
      items: {
        include: {
          dish: { select: { name: true, unit: true } },
          chef: { select: { id: true, name: true } },
        },
        orderBy: { dish: { name: "asc" } },
      },
    },
  });
}

export async function listChefs() {
  await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);
  return db.user.findMany({
    where: { active: true, role: { in: [Role.KITCHEN_HEAD, Role.ADMIN] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}
