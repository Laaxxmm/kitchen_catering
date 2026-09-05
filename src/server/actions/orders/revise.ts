"use server";

/**
 * Changing an order the kitchen has already seen. The revision itself, the urgency
 * banding, the alert fan-out, and the acknowledgements each desk owes before it can
 * carry on working from the old figures.
 */

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import {
  BanquetRequisitionStatus,
  ChefRequisitionStatus,
  MealType,
  OrderStatus,
  Prisma,
  Role,
  VendorPOStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import { ORDER_KITCHEN_ROLES, ORDER_STORE_ROLES, requireRole } from "@/server/rbac";
import { OrderReviseInput } from "@/lib/validators";
import {
  INACTIVE_ORDER_STATUSES,
  KITCHEN_COMMITTED_STATUSES,
  REVISABLE_ORDER_STATUSES,
  STATUS_LABEL,
} from "@/lib/order-status";
import {
  computeRevisionBand,
  isStaleAfterRevision,
  type RevisionBand,
  type RevisionDocumentType,
  type RevisionScope,
} from "@/lib/order-revision";
import { ActionError, actionFailure, type ActionResult } from "@/server/action-result";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { isPackagePricedChannel } from "@/lib/order-channels";
import { notifyRoles } from "@/server/notification-core";
import { deferAfterResponse } from "@/server/defer";
import { formatIST, istToUtc } from "@/lib/time";
import { updateOrderDraft } from "./create";
import { computeLine } from "./_shared";
import { cancelOrder } from "./close";

/**
 * Revise a confirmed order mid-flight — the client changed the headcount
 * (e.g. 50 → 30 pax). Quantities only: headcount, per-existing-line
 * portions (0 removes the line) and, for package-priced channels, the
 * renegotiated package total. Dishes and prices don't move here (dish
 * substitution is the chef's swap flow; full re-pricing means a new order).
 *
 * Allowed while the order is still in the kitchen's hands (up to READY);
 * refused once it's out for delivery / billed / terminal. Within 24h of the
 * event only a manager/admin may revise — sales must escalate.
 *
 * Already-issued stock is deliberately NOT auto-returned: the kitchen is
 * told to review the requisition instead, and any stock correction is a
 * manual adjustment decision (same policy as cancelOrder).
 */
export async function reviseOrder(id: string, raw: unknown): Promise<ActionResult> {
  try {
    return await reviseOrderInner(id, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function reviseOrderInner(id: string, raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.SALES]);
  const input = OrderReviseInput.parse(raw);

  const revised = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      // Dish names ride along so the revision record can say WHICH dish was
      // removed / re-portioned in plain words (the chef reads this).
      include: { items: { include: { dish: { select: { name: true } } } } },
    });
    if (!order) throw new ActionError("Order not found");
    if (!REVISABLE_ORDER_STATUSES.includes(order.status)) {
      throw new ActionError(
        KITCHEN_COMMITTED_STATUSES.includes(order.status)
          ? `This order can't be revised — it is already ${STATUS_LABEL[order.status].toLowerCase()}. The ingredients are issued and the kitchen is working to these numbers. Speak to the chef directly, and record what actually went out after the event.`
          : `Too late — the order is ${STATUS_LABEL[order.status].toLowerCase()}`,
      );
    }

    // 24-hour rule: close to the event the kitchen has already planned and
    // possibly cooked — only a manager/admin may change quantities then.
    const withinDayOfEvent =
      order.eventDate.getTime() - Date.now() < 24 * 60 * 60 * 1000;
    if (withinDayOfEvent && session.user.role === Role.SALES) {
      throw new ActionError(
        "Within 24 hours of the event — ask a manager/admin to make this change.",
      );
    }

    // Banded off the order as it stands right now (inside the transaction),
    // not off whatever the revision moves it to. A CRITICAL revision costs
    // real food, so it needs a human "yes, anyway" — the UI asks, but the
    // gate lives here regardless of what the UI does.
    const band = computeRevisionBand({ eventDate: order.eventDate, status: order.status });
    if (band === "CRITICAL" && !input.criticalConfirmed) {
      throw new ActionError(
        `The event is less than an hour away or the kitchen is already cooking (${STATUS_LABEL[order.status].toLowerCase()}). Confirm you want to revise it anyway — the chef and store will have to redo work.`,
      );
    }

    // Every submitted line must belong to this order.
    const byId = new Map(order.items.map((it) => [it.id, it]));
    for (const li of input.items) {
      if (!byId.has(li.id)) {
        throw new ActionError("A line in this revision no longer exists on the order — refresh and try again.");
      }
    }
    const removals = input.items.filter((li) => li.portions === 0);
    const keeps = input.items.filter((li) => li.portions > 0);
    // Lines the form didn't send stay untouched.
    const untouched = order.items.filter((it) => !input.items.some((li) => li.id === it.id));
    if (keeps.length + untouched.length + (input.addDishes?.length ?? 0) === 0) {
      throw new ActionError("An order needs at least one dish — cancel the order instead of zeroing every line.");
    }

    // Plain-words line diff for the revision record the chef reads.
    const lineChanges: Array<{ kind: "added" | "removed" | "portions"; dish: string; from?: string; to?: string }> = [];
    for (const r of removals) {
      lineChanges.push({ kind: "removed", dish: byId.get(r.id)!.dish.name });
    }

    if (removals.length > 0) {
      await tx.orderItem.deleteMany({
        where: { id: { in: removals.map((r) => r.id) }, orderId: id },
      });
    }
    // Recompute each kept line exactly like updateOrderDraft/computeLine —
    // same price, discount and GST, only the portions change.
    for (const li of keeps) {
      const existing = byId.get(li.id)!;
      if (Number(existing.portions.toString()) !== li.portions) {
        lineChanges.push({
          kind: "portions",
          dish: existing.dish.name,
          from: existing.portions.toString(),
          to: String(li.portions),
        });
      }
      const c = computeLine(
        String(li.portions),
        existing.unitPrice.toString(),
        existing.discountPct.toString(),
        existing.gstRatePct.toString(),
      );
      await tx.orderItem.update({
        where: { id: li.id },
        data: {
          portions: String(li.portions),
          lineSubtotal: c.subtotal.toString(),
          lineTax: c.tax.toString(),
          lineTotal: c.total.toString(),
        },
      });
    }

    // #16: ADD new dishes mid-flight. Priced server-side from each dish's
    // CURRENT catalogue price via computeLine — the client only names the
    // dish and portions, never a price. Runs before the contract-value
    // re-sum below so per-dish channels pick the new lines up; package
    // channels keep their lump sum regardless.
    const addedNames: string[] = [];
    if (input.addDishes && input.addDishes.length > 0) {
      const dishes = await tx.dish.findMany({
        where: { id: { in: input.addDishes.map((d) => d.dishId) } },
        select: { id: true, name: true, unitPrice: true, gstRatePct: true },
      });
      const dishById = new Map(dishes.map((d) => [d.id, d]));
      let sortOrder = order.items.reduce((m, it) => Math.max(m, it.sortOrder), -1) + 1;
      for (const add of input.addDishes) {
        const dish = dishById.get(add.dishId);
        if (!dish) {
          throw new ActionError("A dish in this revision no longer exists — refresh and try again.");
        }
        const c = computeLine(
          String(add.portions),
          dish.unitPrice.toString(),
          "0",
          dish.gstRatePct.toString(),
        );
        await tx.orderItem.create({
          data: {
            orderId: id,
            dishId: dish.id,
            sortOrder: sortOrder++,
            portions: String(add.portions),
            unitPrice: dish.unitPrice.toString(),
            discountPct: "0",
            gstRatePct: dish.gstRatePct.toString(),
            lineSubtotal: c.subtotal.toString(),
            lineTax: c.tax.toString(),
            lineTotal: c.total.toString(),
          },
        });
        addedNames.push(dish.name);
        lineChanges.push({ kind: "added", dish: dish.name, to: String(add.portions) });
      }
    }

    // Contract value: package channels carry the renegotiated lump sum
    // (kept as-is when the form doesn't send one); everything else is the
    // sum of the recomputed lines.
    const isPackageChannel = isPackagePricedChannel(order.channel);
    let contractValue: Decimal;
    if (isPackageChannel) {
      contractValue =
        input.packageTotal != null && input.packageTotal !== ""
          ? new Decimal(input.packageTotal).toDecimalPlaces(2)
          : toDecimal(order.contractValue);
    } else {
      const items = await tx.orderItem.findMany({
        where: { orderId: id },
        select: { lineTotal: true },
      });
      contractValue = items
        .reduce((s, it) => s.plus(toDecimal(it.lineTotal)), new Decimal(0))
        .toDecimalPlaces(2);
    }

    // Reschedule: only when the submitted date differs from the current one.
    // A new date must be in the future — but an UNCHANGED date is left alone
    // even if the event is already underway (same-day pax cuts are normal).
    let newEventDate: Date | null = null;
    if (input.eventDate) {
      const candidate = istToUtc(input.eventDate);
      if (candidate.getTime() !== order.eventDate.getTime()) {
        if (candidate.getTime() <= Date.now()) {
          throw new ActionError("The new event date must be in the future.");
        }
        newEventDate = candidate;
      }
    }

    // #14: meal-type change — applied only when it actually differs.
    const newMealType =
      input.mealType && input.mealType !== order.mealType ? input.mealType : null;

    // Status guard in the WHERE clause: if the order moved (e.g. went out
    // for delivery) between our read and this write, match zero rows and
    // roll the whole revision back.
    const updated = await tx.order.updateMany({
      where: { id, status: { in: REVISABLE_ORDER_STATUSES } },
      data: {
        headcount: input.headcount,
        contractValue: contractValue.toString(),
        ...(newEventDate ? { eventDate: newEventDate } : {}),
        ...(newMealType ? { mealType: newMealType } : {}),
        // Same write, so an order can never be revised without the boards
        // learning about it. Clearing both seen-stamps re-raises the alert
        // for a team that already acknowledged an earlier revision.
        lastRevisedAt: new Date(),
        revisionSeenByChefAt: null,
        revisionSeenByStoreAt: null,
      },
    });
    if (updated.count === 0) {
      const current = await tx.order.findUnique({ where: { id }, select: { status: true } });
      throw new ActionError(
        `Too late — the order is ${current ? STATUS_LABEL[current.status].toLowerCase() : "gone"}. Someone moved it while you were editing — refresh the page.`,
      );
    }

    // Readable revision record — the chef (and everyone else) sees exactly
    // what changed and the manager's note on the order page. The audit row
    // below only stores a hash, which nobody can read back.
    await tx.orderRevision.create({
      data: {
        orderId: id,
        revisedById: session.user.id,
        note: input.revisionNote ?? null,
        beforeHeadcount: order.headcount,
        afterHeadcount: input.headcount,
        beforeContractValue: order.contractValue.toString(),
        afterContractValue: contractValue.toString(),
        beforeEventDate: order.eventDate,
        afterEventDate: newEventDate ?? order.eventDate,
        beforeMealType: order.mealType,
        afterMealType: newMealType ?? order.mealType,
        lineChanges: lineChanges.length > 0 ? lineChanges : undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_REVISED",
        entity: "Order",
        entityId: id,
        payloadHash: sha256Json({
          before: {
            headcount: order.headcount,
            contractValue: order.contractValue.toString(),
            eventDate: order.eventDate.toISOString(),
            mealType: order.mealType,
          },
          after: {
            headcount: input.headcount,
            contractValue: contractValue.toString(),
            eventDate: (newEventDate ?? order.eventDate).toISOString(),
            mealType: newMealType ?? order.mealType,
          },
          removedLines: removals.length,
          addedDishes: addedNames,
          note: input.revisionNote,
        }),
      },
    });

    return { code: order.code, oldPax: order.headcount, newEventDate, newMealType, addedNames, band };
  });

  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/kitchen");

  const noteParts = [
    revised.newEventDate
      ? `Rescheduled to ${formatIST(revised.newEventDate, "EEE d MMM yyyy HH:mm")}.`
      : null,
    revised.newMealType ? `Meal changed to ${revised.newMealType.toLowerCase().replace("_", " ")}.` : null,
    revised.addedNames.length > 0 ? `Added: ${revised.addedNames.join(", ")}.` : null,
    input.revisionNote,
  ]
    .filter(Boolean)
    .join(" ");
  deferAfterResponse("order-revise:notify", () =>
    notifyOrderRevised(id, revised.code, revised.oldPax, input.headcount, noteParts, revised.band),
  );
  return { ok: true };
}

/**
 * Fire-and-forget: tell the kitchen + service teams an in-flight order's
 * quantities changed. Names every downstream document the revision just
 * invalidated — the chef's ingredient requisition, the F&B requisition and
 * any purchase order raised for this order — because each is a separate
 * team who otherwise finds out by accident.
 */
async function notifyOrderRevised(
  orderId: string,
  code: string,
  oldPax: number | null,
  newPax: number,
  note: string,
  band: RevisionBand,
) {
  try {
    // Open = non-terminal and not fully issued/closed. Already-issued stock
    // and already-bought goods are not auto-returned, so each team has to
    // reconcile their own document by hand.
    const [openRequisition, openBanquetRequisition, openPo] = await Promise.all([
      db.chefRequisition.findFirst({
        where: {
          orderId,
          status: {
            in: [
              ChefRequisitionStatus.DRAFT,
              ChefRequisitionStatus.SUBMITTED,
              ChefRequisitionStatus.PARTIALLY_ISSUED,
            ],
          },
        },
        select: { id: true },
      }),
      db.banquetRequisition.findFirst({
        where: {
          orderId,
          status: {
            in: [
              BanquetRequisitionStatus.SUBMITTED,
              BanquetRequisitionStatus.PARTIALLY_ISSUED,
            ],
          },
        },
        select: { id: true },
      }),
      db.vendorPO.findFirst({
        where: {
          orderId,
          status: { notIn: [VendorPOStatus.CANCELLED, VendorPOStatus.CLOSED] },
        },
        select: { id: true },
      }),
    ]);
    const increased = oldPax != null && newPax > oldPax;
    const body =
      (band === "CRITICAL"
        ? "CRITICAL — the event is imminent or the food is already being made. "
        : band === "URGENT"
          ? "URGENT — the event is within a day or the store is already issuing. "
          : "") +
      note +
      (openRequisition
        ? " Review the ingredient requisition — quantities were planned for the old headcount."
        : "") +
      (openBanquetRequisition
        ? " Review the F&B requisition — it was raised against the old order."
        : "") +
      (openPo
        ? " A purchase order is open against this order — check it still buys the right quantities."
        : "") +
      (increased
        ? " You may need more ingredients — raise a top-up requisition for the extra."
        : "");
    // STORE_KEEPER included (#6/#19): the store preps against requisitions
    // that a revision may have just invalidated.
    await notifyRoles([Role.KITCHEN_HEAD, Role.DELIVERY, Role.FNB_SERVICE, Role.STORE_KEEPER], {
      kind: "GENERIC",
      title: `Order ${code} revised — ${oldPax ?? "?"} → ${newPax} pax`,
      body,
      link: `/orders/${orderId}`,
      // Every revision is news — timestamp the key so repeats aren't deduped.
      dedupeKey: `order-revised:${orderId}:${Date.now()}`,
    });
  } catch (err) {
    console.warn("[notify] order-revised fanout failed:", err);
  }
}

// Who may read a scope's revision board and clear its stamp. Chef and store
// each see their own; the manager who made the revision sees both, since
// chasing it up is their job.
const REVISION_SCOPE_ROLES: Record<RevisionScope, Role[]> = {
  chef: [...ORDER_KITCHEN_ROLES, Role.MANAGER],
  store: [...ORDER_STORE_ROLES, Role.MANAGER],
};

// Each downstream document is acknowledged by the desk that owns it.
// BanquetRequisition mirrors REQUISITION_ROLES in actions/banquet.ts (F&B
// raises them, the store counter fulfils them).
const REVISION_DOCUMENT_GATES: Record<
  RevisionDocumentType,
  { roles: Role[]; entity: string }
> = {
  CHEF_REQUISITION: { roles: ORDER_KITCHEN_ROLES, entity: "ChefRequisition" },
  BANQUET_REQUISITION: {
    roles: [Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER],
    entity: "BanquetRequisition",
  },
  VENDOR_PO: { roles: [...ORDER_STORE_ROLES, Role.MANAGER], entity: "VendorPO" },
};

/** One row of `listRevisedOrders` — a revised order still owing a team a look. */
export interface RevisedOrderRow {
  id: string;
  code: string;
  customerName: string;
  eventDate: Date;
  status: OrderStatus;
  headcount: number;
  lastRevisedAt: Date;
  band: RevisionBand;
  /** Latest revision on the order — null only if the record was purged. */
  revision: {
    createdAt: Date;
    note: string | null;
    beforeHeadcount: number;
    afterHeadcount: number;
    beforeEventDate: Date;
    afterEventDate: Date;
    beforeMealType: MealType;
    afterMealType: MealType;
    /** [{kind:"added"|"removed"|"portions", dish, from?, to?}] */
    lineChanges: Prisma.JsonValue;
  } | null;
  /** This scope's documents raised before the revision and not re-checked since. */
  documents: Array<{
    type: RevisionDocumentType;
    id: string;
    number: string;
    status: string;
  }>;
}

/**
 * The revisions a team still owes a look at, newest revision first. An order
 * shows up while EITHER that team hasn't acknowledged the revision itself,
 * OR one of their documents predates it and hasn't been re-checked — so
 * clearing the order-level flag doesn't hide a requisition still built for
 * the old headcount. Terminal orders are excluded: nothing left to redo.
 */
export async function listRevisedOrders(scope: RevisionScope): Promise<RevisedOrderRow[]> {
  await requireRole(REVISION_SCOPE_ROLES[scope]);
  const rows = await db.order.findMany({
    where: { lastRevisedAt: { not: null }, status: { notIn: INACTIVE_ORDER_STATUSES } },
    select: {
      id: true,
      code: true,
      eventDate: true,
      status: true,
      headcount: true,
      lastRevisedAt: true,
      revisionSeenByChefAt: true,
      revisionSeenByStoreAt: true,
      customer: { select: { name: true } },
      orderRevisions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          createdAt: true,
          note: true,
          beforeHeadcount: true,
          afterHeadcount: true,
          beforeEventDate: true,
          afterEventDate: true,
          beforeMealType: true,
          afterMealType: true,
          lineChanges: true,
        },
      },
      // All three sets are fetched and the scope picks from them in memory:
      // staleness compares two columns (lastRevisedAt vs ackAt/createdAt),
      // which Prisma can't express in a where clause.
      chefRequisitions: {
        where: { status: { not: ChefRequisitionStatus.CANCELLED } },
        select: { id: true, requisitionNo: true, status: true, createdAt: true, revisionAckAt: true },
      },
      banquetRequisitions: {
        where: { status: { not: BanquetRequisitionStatus.CANCELLED } },
        select: { id: true, requisitionNo: true, status: true, createdAt: true, revisionAckAt: true },
      },
      vendorPos: {
        where: { status: { not: VendorPOStatus.CANCELLED } },
        select: { id: true, poNo: true, status: true, createdAt: true, revisionAckAt: true },
      },
    },
    orderBy: { lastRevisedAt: "desc" },
    take: 200,
  });

  const now = new Date();
  return rows.flatMap((o) => {
    // Non-null by the where clause above; Prisma can't narrow it for us.
    const lastRevisedAt = o.lastRevisedAt!;
    const docs =
      scope === "chef"
        ? o.chefRequisitions.map((r) => ({
            type: "CHEF_REQUISITION" as const,
            id: r.id,
            number: r.requisitionNo,
            status: String(r.status),
            createdAt: r.createdAt,
            ackAt: r.revisionAckAt,
          }))
        : [
            ...o.banquetRequisitions.map((r) => ({
              type: "BANQUET_REQUISITION" as const,
              id: r.id,
              number: r.requisitionNo,
              status: String(r.status),
              createdAt: r.createdAt,
              ackAt: r.revisionAckAt,
            })),
            ...o.vendorPos.map((p) => ({
              type: "VENDOR_PO" as const,
              id: p.id,
              number: p.poNo,
              status: String(p.status),
              createdAt: p.createdAt,
              ackAt: p.revisionAckAt,
            })),
          ];
    const stale = docs.filter((d) =>
      isStaleAfterRevision({ lastRevisedAt, ackAt: d.ackAt, createdAt: d.createdAt }),
    );
    const seenAt = scope === "chef" ? o.revisionSeenByChefAt : o.revisionSeenByStoreAt;
    const unseen = !seenAt || seenAt.getTime() < lastRevisedAt.getTime();
    if (!unseen && stale.length === 0) return [];
    return [
      {
        id: o.id,
        code: o.code,
        customerName: o.customer.name,
        eventDate: o.eventDate,
        status: o.status,
        headcount: o.headcount,
        lastRevisedAt,
        band: computeRevisionBand({ eventDate: o.eventDate, status: o.status, now }),
        revision: o.orderRevisions[0] ?? null,
        documents: stale.map((d) => ({
          type: d.type,
          id: d.id,
          number: d.number,
          status: d.status,
        })),
      },
    ];
  });
}

/**
 * A named human confirms their team has seen the revision. Stamps that
 * team's seen column and logs who — this is the accountability record, so
 * "nobody told the kitchen" stops being arguable. Only stamps an order that
 * actually carries a revision.
 */
export async function acknowledgeOrderRevision(
  orderId: string,
  scope: RevisionScope,
): Promise<ActionResult> {
  try {
    const session = await requireRole(REVISION_SCOPE_ROLES[scope]);
    const seenAt = new Date();
    await db.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, lastRevisedAt: { not: null } },
        data:
          scope === "chef"
            ? { revisionSeenByChefAt: seenAt }
            : { revisionSeenByStoreAt: seenAt },
      });
      if (updated.count === 0) {
        throw new ActionError("Nothing to acknowledge — this order has no revision on it.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: scope === "chef" ? "ORDER_REVISION_SEEN_CHEF" : "ORDER_REVISION_SEEN_STORE",
          entity: "Order",
          entityId: orderId,
          payloadHash: sha256Json({ scope, seenAt: seenAt.toISOString() }),
        },
      });
    });
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    revalidatePath("/kitchen");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Confirm one downstream document has been re-checked against the latest
 * revision — the requisition's quantities re-done, the PO verified. Clears
 * that document off the revision board without touching the others, so a
 * chef who fixed their requisition doesn't silently sign off the store's
 * purchase order too.
 */
export async function acknowledgeRevisedDocument(
  type: RevisionDocumentType,
  documentId: string,
): Promise<ActionResult> {
  try {
    const gate = REVISION_DOCUMENT_GATES[type];
    const session = await requireRole(gate.roles);
    const revisionAckAt = new Date();
    const where = { id: documentId };
    const data = { revisionAckAt };
    const { count } =
      type === "CHEF_REQUISITION"
        ? await db.chefRequisition.updateMany({ where, data })
        : type === "BANQUET_REQUISITION"
          ? await db.banquetRequisition.updateMany({ where, data })
          : await db.vendorPO.updateMany({ where, data });
    if (count === 0) {
      throw new ActionError("That document no longer exists — refresh and try again.");
    }
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_REVISION_DOCUMENT_ACKED",
        entity: gate.entity,
        entityId: documentId,
        payloadHash: sha256Json({ type, revisionAckAt: revisionAckAt.toISOString() }),
      },
    });
    revalidatePath("/orders");
    revalidatePath("/kitchen");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}
