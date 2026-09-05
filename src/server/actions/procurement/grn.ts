"use server";

/**
 * Receiving the goods. One GRN per delivery: accept and reject per line, take more
 * than was ordered or items the PO never listed (amending the PO to match), post the
 * accepted stock, and re-open any requisition line that was waiting on it.
 */

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import {
  BanquetRequisitionLineStatus,
  BanquetRequisitionStatus,
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  GRNStatus,
  Prisma,
  Role,
  VendorPOStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { ActionError, actionFailure, type ActionResultWith } from "@/server/action-result";
import { deferAfterResponse } from "@/server/defer";
import { GRNCreateInput } from "@/lib/validators";
import { computeLine, summarise } from "@/lib/gst";
import { humanizeStatus } from "@/lib/order-status";
import { indefineStateCode } from "@/lib/org";
import { nextGRNNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { newMovingAverage } from "@/lib/inventory-cost";
import { unitsEquivalent } from "@/lib/units";
import { toDecimal } from "@/lib/money";
import { createNotification, notifyRoles } from "@/server/notification-core";
import { lockBanquetItemRows, recomputeBanquetReqStatus } from "@/server/banquet-core";
import { READ_ROLES, RECEIVED_GRN_STATUSES, recomputeChefReqStatusTx } from "./_shared";

// =====================================================================
// GRN
// =====================================================================

/**
 * Create a GRN against an APPROVED/SENT/PARTIALLY_RECEIVED PO. Atomically:
 *   1. Validate received qty doesn't exceed remaining
 *   2. Create GRN + GRNLines
 *   3. For each accepted line tied to an Ingredient: create IngredientReceipt
 *      and update Ingredient.onHandQty + avgUnitCost via moving-average
 *   3b. For each accepted line tied to a BanquetItem: create a BanquetReceipt,
 *      bump BanquetItem.currentStock, and flip any linked banquet requisition
 *      lines (AWAITING_PROCUREMENT → PENDING) so the store can issue them
 *   4. Update VendorPOLine.receivedQty
 *   5. Recompute GRN status (ACCEPTED / PARTIALLY_ACCEPTED)
 *   6. Recompute PO status (RECEIVED / PARTIALLY_RECEIVED)
 *   7. Write AuditLog
 *
 * Unit-mismatch guard: steps 3/3b assume the PO line's unit equals the
 * catalogue unit. Since PO lines are editable on drafts (the store often
 * buys "piece" where the catalogue tracks "pkt"), a mismatched line's
 * accepted qty would corrupt stock and moving-average cost. Such lines
 * SKIP the auto-posting; the receipt is still recorded on the GRN/PO and
 * a warning is returned (and notified) so the store corrects stock by
 * hand via stock count / receipt.
 */
export async function createGRN(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; grnNo: string; warnings?: string[] }>> {
  try {
    return await createGRNInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

// Unit comparison now lives in @/lib/units (unitsEquivalent), which folds
// spelling variants — "pcts"/"pct", "Nos"/"nos", "Kgs"/"kg" — so a typing
// difference can't stop received goods reaching stock. Genuinely different
// measures (pkt vs kg) still block, because only a human knows the pack size.

/**
 * Row-lock an ingredient for the rest of the transaction (local mirror of
 * inventory.ts lockIngredientRow — kept local so this "use server" module
 * doesn't import an action out of another "use server" module). GRN stock
 * posting reads onHandQty/avgUnitCost, computes a moving average and writes
 * back; without the lock two concurrent GRNs read the same snapshot and one
 * update is silently lost (corrupting stock + average cost).
 */
async function lockIngredientRow(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "Ingredient" WHERE "id" = ${id} FOR UPDATE`;
}

async function createGRNInner(
  raw: unknown,
): Promise<{ ok: true; id: string; grnNo: string; warnings?: string[] }> {
  // The store keeper records the goods receipt when the vendor delivers
  // against their PO. Manager / admin / accounts can too.
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.STORE_KEEPER]);
  const input = GRNCreateInput.parse(raw);

  // Requisition lines flipped back to PENDING by this GRN — collected inside
  // the tx, used for the deferred notifications + page revalidation after it.
  const banquetFlips: Array<{
    reqId: string;
    requisitionNo: string;
    createdById: string;
    itemName: string;
  }> = [];
  // M16: same, for chef (kitchen) requisition lines bought via this PO.
  const chefFlips: Array<{
    reqId: string;
    requisitionNo: string;
    createdById: string;
    itemName: string;
  }> = [];
  // True when any accepted line bumped banquet stock (with or without a
  // linked requisition line) — the banquet pages need revalidating then.
  let banquetPosted = false;
  // Unit-mismatch warnings: stock was NOT auto-posted for these lines.
  // Surfaced in the action's return (UI toasts them) and deferred-notified
  // to the store so the manual correction doesn't get forgotten.
  const warnings: string[] = [];

  const result = await db.$transaction(async (tx) => {
    const po = await tx.vendorPO.findUnique({
      where: { id: input.poId },
      include: {
        lines: {
          include: {
            ingredient: true,
            banquetItem: { select: { name: true, unit: true } },
          },
        },
        vendor: { select: { name: true } },
      },
    });
    if (!po) throw new ActionError("PO not found");
    // RECEIVED is here on purpose. A PO reaches it once every line is
    // received or rejected — and a rejected line is exactly the one a vendor
    // re-sends the next morning. The real protection is per line below:
    // anything beyond what the line still has open needs a written reason.
    // What this guard is actually for is stopping receipts against a PO that
    // is draft, cancelled or closed.
    const ok =
      po.status === VendorPOStatus.APPROVED ||
      po.status === VendorPOStatus.SENT ||
      po.status === VendorPOStatus.PARTIALLY_RECEIVED ||
      po.status === VendorPOStatus.RECEIVED;
    if (!ok) {
      throw new ActionError(
        `Cannot receive against a ${humanizeStatus(po.status).toLowerCase()} purchase order.`,
      );
    }

    // M7: lock every PO line this GRN receives against (sorted, FOR UPDATE)
    // and re-read receivedQty under the lock. The include snapshot is stale —
    // two concurrent GRNs against the same PO would otherwise both read the
    // pre-receipt receivedQty, both pass the over-receive check, and push
    // received past ordered.
    const touchedLineIds = [...new Set(input.lines.map((li) => li.poLineId))].sort();
    for (const lineId of touchedLineIds) {
      await tx.$executeRaw`SELECT 1 FROM "VendorPOLine" WHERE "id" = ${lineId} FOR UPDATE`;
    }
    const lockedLines = await tx.vendorPOLine.findMany({
      where: { id: { in: touchedLineIds } },
      select: { id: true, receivedQty: true },
    });
    const receivedQtyById = new Map(lockedLines.map((l) => [l.id, l.receivedQty]));

    // ── Items the vendor delivered that the PO never listed ──────────────
    // They join the PO as new lines, priced as delivered, and are then
    // received by the ordinary loop below. Off-PO stock with no PO line
    // would leave the supplier's bill nothing to reconcile against, and the
    // 3-way match reads PO vs GRN vs bill.
    const poLines = [...po.lines];
    const grnLineInputs = [...input.lines];
    const amendments: Array<{ description: string; from: string; to: string; reason: string }> = [];

    if (input.extraLines && input.extraLines.length > 0) {
      const maxSort = poLines.reduce((m, l) => Math.max(m, l.sortOrder), -1);
      const createdIds: string[] = [];
      for (const [idx, extra] of input.extraLines.entries()) {
        const qty = toDecimal(extra.quantity);
        if (qty.lte(0)) throw new ActionError("An added item needs a quantity above zero.");
        // The item names itself — description, unit and code come off the
        // catalogue row, never off the form, so an added line reads exactly
        // like one raised on the PO in the first place.
        const [ingredient, banquetItem] = await Promise.all([
          extra.ingredientId
            ? tx.ingredient.findUnique({
                where: { id: extra.ingredientId },
                select: { id: true, name: true, unit: true, sku: true },
              })
            : Promise.resolve(null),
          extra.banquetItemId
            ? tx.banquetItem.findUnique({
                where: { id: extra.banquetItemId },
                select: { id: true, name: true, unit: true, sku: true },
              })
            : Promise.resolve(null),
        ]);
        const item = ingredient ?? banquetItem;
        if (!item) throw new ActionError("The added item is not in the catalogue.");

        const { subtotal, tax, total } = computeLine({
          quantity: extra.quantity,
          unitPrice: extra.unitPrice,
          discountPct: "0",
          gstRatePct: extra.gstRatePct ?? "0",
        });
        const created = await tx.vendorPOLine.create({
          data: {
            poId: po.id,
            sortOrder: maxSort + 1 + idx,
            ingredientId: ingredient?.id ?? null,
            banquetItemId: banquetItem?.id ?? null,
            sku: item.sku ?? "",
            description: item.name,
            unit: item.unit,
            quantity: extra.quantity,
            unitPrice: extra.unitPrice,
            gstRatePct: extra.gstRatePct ?? "0",
            lineSubtotal: subtotal.toString(),
            lineTax: tax.toString(),
            lineTotal: total.toString(),
          },
        });
        createdIds.push(created.id);
        grnLineInputs.push({
          poLineId: created.id,
          acceptedQty: extra.quantity,
          rejectedQty: "0",
          reason: extra.reason,
        });
        amendments.push({
          description: item.name,
          from: "not on the PO",
          to: `${extra.quantity} ${item.unit}`,
          reason: extra.reason,
        });
      }
      // Re-read with the loop's include shape so the new lines post stock
      // exactly like the ones raised on the PO.
      const created = await tx.vendorPOLine.findMany({
        where: { id: { in: createdIds } },
        include: { ingredient: true, banquetItem: { select: { name: true, unit: true } } },
      });
      poLines.push(...created);
    }

    // H1: lock every ingredient this GRN will post stock to, up front and in
    // a stable (sorted) order — concurrent GRNs touching the same ingredients
    // can't deadlock and can't lose each other's moving-average update. The
    // catalogue snapshot is re-read under the lock at the compute site below.
    const ingredientLockIds = new Set<string>();
    for (const li of grnLineInputs) {
      const pl = poLines.find((l) => l.id === li.poLineId);
      if (pl?.ingredientId && toDecimal(li.acceptedQty).gt(0)) {
        ingredientLockIds.add(pl.ingredientId);
      }
    }
    for (const ingId of [...ingredientLockIds].sort()) {
      await lockIngredientRow(tx, ingId);
    }

    const grnNo = await nextGRNNumber(tx);
    const grn = await tx.gRN.create({
      data: {
        grnNo,
        poId: po.id,
        status: GRNStatus.DRAFT,
        receivedAt: new Date(),
        receivedByUserId: session.user.id,
        notes: input.notes ?? null,
      },
    });

    for (let i = 0; i < grnLineInputs.length; i++) {
      const lineInput = grnLineInputs[i];
      const poLine = poLines.find((l) => l.id === lineInput.poLineId);
      if (!poLine) throw new ActionError("PO line not found");

      // M7: use the receivedQty re-read under the row lock, not the stale
      // include snapshot (fallback keeps a non-PO line failing the find below).
      const freshReceivedQty = receivedQtyById.get(poLine.id) ?? poLine.receivedQty;
      const orderedRemaining = toDecimal(poLine.quantity).minus(toDecimal(freshReceivedQty));
      const accepted = toDecimal(lineInput.acceptedQty);
      const rejected = toDecimal(lineInput.rejectedQty ?? "0");
      if (accepted.lt(0) || rejected.lt(0)) throw new ActionError("Quantities must be non-negative");

      // 100 g ordered, 500 g delivered, and the kitchen wants it. Refusing
      // left the store with stock on the shelf and nothing in the system, so
      // instead the PO line is raised to what actually turned up — the
      // supplier's bill then has a PO line to agree with, and the 3-way
      // match still means something. Committed spend is changing, so it
      // takes a written reason.
      const takingTotal = accepted.plus(rejected);
      if (takingTotal.gt(orderedRemaining)) {
        if (!lineInput.overReceiptReason?.trim()) {
          throw new ActionError(
            `"${poLine.description}": the PO has ${orderedRemaining.toString()} ${poLine.unit} left, you're recording ${takingTotal.toString()}. Say why you're taking more than was ordered.`,
          );
        }
        const newQuantity = toDecimal(freshReceivedQty).plus(takingTotal);
        const { subtotal, tax, total } = computeLine({
          quantity: newQuantity.toString(),
          unitPrice: poLine.unitPrice.toString(),
          discountPct: "0",
          gstRatePct: poLine.gstRatePct.toString(),
        });
        await tx.vendorPOLine.update({
          where: { id: poLine.id },
          data: {
            quantity: newQuantity.toString(),
            lineSubtotal: subtotal.toString(),
            lineTax: tax.toString(),
            lineTotal: total.toString(),
          },
        });
        amendments.push({
          description: poLine.description,
          from: `${poLine.quantity.toString()} ${poLine.unit}`,
          to: `${newQuantity.toString()} ${poLine.unit}`,
          reason: lineInput.overReceiptReason.trim(),
        });
        // Everything downstream — the GRN line's orderedQty, the PO status
        // roll-up — must read the raised figure, not the ordered one.
        poLine.quantity = new Prisma.Decimal(newQuantity.toString());
      }

      const grnLine = await tx.gRNLine.create({
        data: {
          grnId: grn.id,
          poLineId: poLine.id,
          sortOrder: i,
          orderedQty: poLine.quantity.toString(),
          acceptedQty: accepted.toString(),
          rejectedQty: rejected.toString(),
          reason: lineInput.reason ?? null,
        },
      });

      // A free-text PO line (no linked kitchen ingredient or banquet item)
      // has nowhere to post — warn instead of silently doing nothing (the
      // "GRN posted but stock didn't move" surprise). One-off non-stock buys
      // can ignore it; anything that should count must be linked/adjusted.
      if (accepted.gt(0) && !poLine.ingredientId && !poLine.banquetItemId) {
        warnings.push(
          `GRN ${grnNo}: "${poLine.description}" isn't linked to a stock item, so nothing was added to stock. If it should count, add it to Kitchen/Banquet stock and record it via Stock adjustment.`,
        );
      }

      // Does the purchase unit differ from the catalogue in a way that
      // actually matters? Spelling variants ("pcts" vs "pct") are the same
      // measure and must not block posting; packet vs kg genuinely does.
      const unitDiffers =
        accepted.gt(0) && poLine.ingredientId && poLine.ingredient
          ? !unitsEquivalent(poLine.unit, poLine.ingredient.unit)
          : false;
      // An item nobody has transacted yet has no balance to corrupt, so the
      // catalogue simply adopts the unit it's actually bought in and the goods
      // post normally. This is the same safe rule the reconcile tool applies —
      // doing it here stops the backlog re-forming after every GRN.
      const canRebaseUnit =
        unitDiffers && poLine.ingredientId
          ? await (async () => {
              const [receipts, issues, fresh] = await Promise.all([
                tx.ingredientReceipt.count({ where: { ingredientId: poLine.ingredientId! } }),
                tx.ingredientIssue.count({ where: { ingredientId: poLine.ingredientId! } }),
                tx.ingredient.findUniqueOrThrow({
                  where: { id: poLine.ingredientId! },
                  select: { onHandQty: true },
                }),
              ]);
              return receipts === 0 && issues === 0 && toDecimal(fresh.onHandQty).eq(0);
            })()
          : false;

      // Post inventory only if accepted > 0 AND the PO line links to an Ingredient.
      if (unitDiffers && !canRebaseUnit && poLine.ingredient) {
        // PO bought in a genuinely different unit on an item that already
        // holds stock — the accepted qty/price would corrupt onHandQty and
        // moving-average cost. Record the receipt on the GRN but leave stock
        // alone; /admin/stock-reconcile lets an admin post it with the real
        // conversion.
        warnings.push(
          `GRN ${grnNo}: ${poLine.ingredient.name} received in ${poLine.unit.trim()} but the catalogue tracks ${poLine.ingredient.unit.trim()} — stock NOT auto-updated. An admin can post it from Reconcile received stock.`,
        );
      } else if (accepted.gt(0) && poLine.ingredientId && poLine.ingredient) {
        if (canRebaseUnit) {
          await tx.ingredient.update({
            where: { id: poLine.ingredientId },
            data: { unit: poLine.unit.trim() },
          });
        }
        // H1: re-read onHandQty/avgUnitCost under the row lock taken above —
        // the PO-include snapshot (poLine.ingredient) is stale by now.
        const ing = await tx.ingredient.findUniqueOrThrow({
          where: { id: poLine.ingredientId },
          select: { id: true, onHandQty: true, avgUnitCost: true },
        });
        const { qty: newQty, avgUnitCost: newAvg } = newMovingAverage({
          onHandQty: ing.onHandQty,
          avgUnitCost: ing.avgUnitCost,
          receiptQty: accepted,
          receiptUnitCost: poLine.unitPrice,
        });
        await tx.ingredient.update({
          where: { id: ing.id },
          data: {
            onHandQty: newQty.toDecimalPlaces(3).toString(),
            avgUnitCost: newAvg.toDecimalPlaces(4).toString(),
          },
        });
        await tx.ingredientReceipt.create({
          data: {
            ingredientId: ing.id,
            qty: accepted.toString(),
            unitCost: poLine.unitPrice.toString(),
            receivedAt: new Date(),
            supplier: null,
            note: `Auto-posted from GRN ${grnNo}`,
            grnLineId: grnLine.id,
          },
        });

        // M16: chef requisition lines waiting on this exact PO line — the
        // goods are in and stock is posted, so they're issuable again.
        // Mirrors the banquet flip below. Guarded on line status AND a live
        // parent so a cancelled requisition isn't resurrected.
        //
        // Matches by back-link OR by ingredient: a PO raised manually (typed
        // lines, not the ?reqId= prefill) carries no back-link, and matching
        // only vendorPOLineId left those requisition lines frozen at
        // "awaiting procurement" while the goods sat posted on the shelf —
        // the recurring "GRN accepted but can't issue" complaint. Goods for
        // this ingredient have arrived; every live line waiting on it
        // becomes issuable. Issuing still checks stock, so over-flipping is
        // harmless.
        const chefLinked = await tx.chefRequisitionLine.findMany({
          where: {
            OR: [{ vendorPOLineId: poLine.id }, { ingredientId: poLine.ingredientId }],
            status: ChefRequisitionLineStatus.AWAITING_PROCUREMENT,
            requisition: {
              status: {
                in: [ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED],
              },
            },
          },
          select: {
            id: true,
            requisitionId: true,
            requisition: { select: { requisitionNo: true, createdById: true } },
            ingredient: { select: { name: true } },
          },
        });
        if (chefLinked.length > 0) {
          await tx.chefRequisitionLine.updateMany({
            where: { id: { in: chefLinked.map((l) => l.id) } },
            data: { status: ChefRequisitionLineStatus.PENDING },
          });
          for (const reqId of new Set(chefLinked.map((l) => l.requisitionId))) {
            await recomputeChefReqStatusTx(tx, reqId, session.user.id);
          }
          chefFlips.push(
            ...chefLinked.map((l) => ({
              reqId: l.requisitionId,
              requisitionNo: l.requisition.requisitionNo,
              createdById: l.requisition.createdById,
              itemName: l.ingredient.name,
            })),
          );
        }
      }

      // Banquet-store goods (PO raised off an F&B requisition shortfall):
      // post a real BanquetReceipt, bump the item's stock, and flip the
      // linked requisition lines back to PENDING so the store issues them.
      if (accepted.gt(0) && poLine.banquetItemId && poLine.banquetItem &&
          !unitsEquivalent(poLine.unit, poLine.banquetItem.unit)) {
        // Same unit-mismatch guard as the ingredient branch: no receipt, no
        // stock bump — and deliberately NO requisition-line flip. If stock
        // wasn't posted the store can't issue, so linked lines stay
        // AWAITING_PROCUREMENT until the manual correction is done.
        const stuck = await tx.banquetRequisitionLine.findMany({
          where: {
            vendorPOLineId: poLine.id,
            status: BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
          },
          select: { requisition: { select: { requisitionNo: true } } },
        });
        const stuckNos = [...new Set(stuck.map((s) => s.requisition.requisitionNo))];
        warnings.push(
          `GRN ${grnNo}: ${poLine.banquetItem.name} received in ${poLine.unit.trim()} but the catalogue tracks ${poLine.banquetItem.unit.trim()} — stock NOT auto-updated; correct it via stock count / receipt and then issue.` +
            (stuckNos.length > 0
              ? ` Requisition ${stuckNos.join(", ")} stays awaiting procurement until then.`
              : ""),
        );
      } else if (accepted.gt(0) && poLine.banquetItemId) {
        banquetPosted = true;
        // Same row-lock discipline as every other banquet stock movement —
        // a concurrent issue/receipt must not race the increment.
        await lockBanquetItemRows(tx, [poLine.banquetItemId]);
        const receipt = await tx.banquetReceipt.create({
          data: {
            receivedAt: new Date(),
            recordedById: session.user.id,
            sourceNote: `Auto-posted from GRN ${grnNo} (${po.poNo})`,
            sourceContact: po.vendor?.name ?? null,
            lines: {
              create: [
                {
                  itemId: poLine.banquetItemId,
                  quantity: accepted.toString(),
                  costPerUnit: poLine.unitPrice.toString(),
                },
              ],
            },
          },
        });
        await tx.banquetItem.update({
          where: { id: poLine.banquetItemId },
          data: { currentStock: { increment: new Prisma.Decimal(accepted.toString()) } },
        });

        // Requisition lines waiting on these goods: issuable again. By
        // back-link OR by item — a manually-raised PO carries no back-link,
        // and matching only vendorPOLineId froze those lines at "awaiting
        // procurement" with the stock already on the shelf (same bug as the
        // kitchen side). Live requisitions only, so a cancelled one isn't
        // resurrected; parent statuses are recomputed per req below.
        const linked = await tx.banquetRequisitionLine.findMany({
          where: {
            OR: [{ vendorPOLineId: poLine.id }, { itemId: poLine.banquetItemId }],
            status: BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
            requisition: {
              status: {
                in: [BanquetRequisitionStatus.SUBMITTED, BanquetRequisitionStatus.PARTIALLY_ISSUED],
              },
            },
          },
          select: {
            id: true,
            requisitionId: true,
            requisition: { select: { requisitionNo: true, createdById: true } },
            item: { select: { name: true } },
          },
        });
        if (linked.length > 0) {
          await tx.banquetRequisitionLine.updateMany({
            where: { id: { in: linked.map((l) => l.id) } },
            data: { status: BanquetRequisitionLineStatus.PENDING },
          });
          for (const reqId of new Set(linked.map((l) => l.requisitionId))) {
            await recomputeBanquetReqStatus(tx, reqId, session.user.id);
          }
          banquetFlips.push(
            ...linked.map((l) => ({
              reqId: l.requisitionId,
              requisitionNo: l.requisition.requisitionNo,
              createdById: l.requisition.createdById,
              itemName: l.item.name,
            })),
          );
        }

        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: "BANQUET_STOCK_FROM_GRN",
            entity: "BanquetReceipt",
            entityId: receipt.id,
            payloadHash: sha256Json({
              grnNo,
              poLineId: poLine.id,
              itemId: poLine.banquetItemId,
              qty: accepted.toString(),
              reqLinesFlipped: linked.length,
            }),
          },
        });
      }

      // Update PO line receivedQty. L4: pass a Decimal, not a JS float, so the
      // increment stays exact (the row is locked above, but atomic increment
      // is simplest and correct).
      await tx.vendorPOLine.update({
        where: { id: poLine.id },
        data: { receivedQty: { increment: new Prisma.Decimal(accepted.toString()) } },
      });
    }

    // Recompute GRN status
    const grnLines = await tx.gRNLine.findMany({ where: { grnId: grn.id } });
    const anyRejected = grnLines.some((l) => toDecimal(l.rejectedQty).gt(0));
    const newGrnStatus = anyRejected ? GRNStatus.PARTIALLY_ACCEPTED : GRNStatus.ACCEPTED;

    // Recompute PO status.
    //
    // A line is settled when nothing more is expected on it — received in
    // full, OR the balance was rejected. Rejecting is the store saying "this
    // isn't coming": on receivedQty alone the PO sat at PARTIALLY_RECEIVED
    // for ever, which took the supplier's bill with it and left the whole
    // order stuck behind goods that were never going to arrive.
    //
    // Rejected quantity is NOT deducted from receivedQty and does not block
    // a later delivery — orderedRemaining above still measures against
    // receivedQty, so a vendor who re-sends a rejected item can still be
    // received against the same line.
    const poLinesNow = await tx.vendorPOLine.findMany({ where: { poId: po.id } });
    const rejectedByLine = new Map(
      (
        await tx.gRNLine.groupBy({
          by: ["poLineId"],
          where: { poLineId: { in: poLinesNow.map((l) => l.id) } },
          _sum: { rejectedQty: true },
        })
      ).map((r) => [r.poLineId, toDecimal(r._sum.rejectedQty ?? 0)]),
    );
    const allSettled = poLinesNow.every((l) =>
      toDecimal(l.receivedQty)
        .plus(rejectedByLine.get(l.id) ?? 0)
        .gte(toDecimal(l.quantity)),
    );
    const newPoStatus = allSettled ? VendorPOStatus.RECEIVED : VendorPOStatus.PARTIALLY_RECEIVED;

    await tx.gRN.update({ where: { id: grn.id }, data: { status: newGrnStatus } });

    // An amended PO carries amended totals. Same summarise() the creation
    // and edit paths use, over every line — so a PO the delivery changed
    // adds up exactly like one raised that way to begin with, and the
    // supplier's bill has the right figure to match against.
    const amendedTotals =
      amendments.length > 0
        ? summarise({
            lines: poLinesNow.map((l) => ({
              quantity: l.quantity.toString(),
              unitPrice: l.unitPrice.toString(),
              discountPct: "0",
              gstRatePct: l.gstRatePct.toString(),
            })),
            supplierStateCode: indefineStateCode(),
            placeOfSupplyStateCode: po.placeOfSupplyStateCode,
          })
        : null;
    await tx.vendorPO.update({
      where: { id: po.id },
      data: {
        status: newPoStatus,
        ...(amendedTotals
          ? {
              subtotal: amendedTotals.subtotal.toString(),
              taxTotal: amendedTotals.taxTotal.toString(),
              grandTotal: amendedTotals.grandTotal.toString(),
            }
          : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "GRN_CREATED",
        entity: "GRN",
        entityId: grn.id,
        payloadHash: sha256Json({ poId: po.id, lines: grnLineInputs.length }),
      },
    });

    // The delivery changed the order. Recorded separately from the GRN so
    // "who agreed to pay for more than we ordered, and why" is one row, not
    // something to be inferred by diffing a PO against its own GRN.
    if (amendments.length > 0) {
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "PO_AMENDED_AT_RECEIPT",
          entity: "VendorPO",
          entityId: po.id,
          payloadHash: sha256Json({ grnNo, amendments }),
        },
      });
    }

    return { id: grn.id, grnNo };
  });

  // Banquet stock arrived and requisition lines re-opened — tell the store
  // counter and the F&B requester. Deferred: fan-out must never block (or
  // undo) the committed GRN.
  if (banquetFlips.length > 0) {
    const grnNo = result.grnNo;
    const grnId = result.id;
    const actorId = session.user.id;
    deferAfterResponse("grn-banquet:notify", async () => {
      // Group per requisition so multi-line GRNs send one ping per BRQ.
      const byReq = new Map<
        string,
        { requisitionNo: string; createdById: string; items: string[] }
      >();
      for (const f of banquetFlips) {
        const entry = byReq.get(f.reqId) ?? {
          requisitionNo: f.requisitionNo,
          createdById: f.createdById,
          items: [],
        };
        entry.items.push(f.itemName);
        byReq.set(f.reqId, entry);
      }
      for (const [reqId, f] of byReq) {
        await notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
          kind: "GENERIC",
          title: `Goods for ${f.requisitionNo} arrived — open to issue`,
          body: `${f.items.join(", ")} received via GRN ${grnNo}.`,
          link: `/banquet/requisitions/${reqId}`,
          dedupeKey: `grn-banquet:${grnId}:${reqId}`,
        });
        // The requester hears it directly too (skip self-notification).
        if (f.createdById !== actorId) {
          await createNotification({
            userId: f.createdById,
            kind: "GENERIC",
            title: `Your ${f.items.join(", ")} has arrived — the store can issue it now`,
            body: `${f.requisitionNo}: received via GRN ${grnNo}.`,
            link: `/banquet/requisitions/${reqId}`,
            dedupeKey: `grn-banquet-req:${grnId}:${reqId}`,
          });
        }
      }
    });
    for (const reqId of new Set(banquetFlips.map((f) => f.reqId))) {
      revalidatePath(`/banquet/requisitions/${reqId}`);
    }
    revalidatePath("/banquet/requisitions");
  }
  if (banquetPosted) {
    revalidatePath("/banquet");
    revalidatePath("/banquet/items");
    revalidatePath("/dashboard");
  }

  // M16: kitchen stock arrived and chef requisition lines re-opened — tell
  // the store counter and the chef who raised them. Same shape as the
  // banquet fan-out above.
  if (chefFlips.length > 0) {
    const grnNo = result.grnNo;
    const grnId = result.id;
    const actorId = session.user.id;
    deferAfterResponse("grn-chefreq:notify", async () => {
      const byReq = new Map<
        string,
        { requisitionNo: string; createdById: string; items: string[] }
      >();
      for (const f of chefFlips) {
        const entry = byReq.get(f.reqId) ?? {
          requisitionNo: f.requisitionNo,
          createdById: f.createdById,
          items: [],
        };
        entry.items.push(f.itemName);
        byReq.set(f.reqId, entry);
      }
      for (const [reqId, f] of byReq) {
        await notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
          kind: "GENERIC",
          title: `Goods for ${f.requisitionNo} arrived — open to issue`,
          body: `${f.items.join(", ")} received via GRN ${grnNo}.`,
          link: `/requisitions/${reqId}`,
          dedupeKey: `grn-chefreq:${grnId}:${reqId}`,
        });
        if (f.createdById !== actorId) {
          await createNotification({
            userId: f.createdById,
            kind: "GENERIC",
            title: `Your ${f.items.join(", ")} has arrived — the store can issue it now`,
            body: `${f.requisitionNo}: received via GRN ${grnNo}.`,
            link: `/requisitions/${reqId}`,
            dedupeKey: `grn-chefreq-req:${grnId}:${reqId}`,
          });
        }
      }
    });
    for (const reqId of new Set(chefFlips.map((f) => f.reqId))) {
      revalidatePath(`/requisitions/${reqId}`);
    }
    revalidatePath("/requisitions");
    revalidatePath("/queue/issuing");
  }

  // Unit mismatches: stock was NOT auto-posted for some lines. Tell the
  // store team so the manual stock correction actually happens — the toast
  // the receiving user sees dies with their browser tab.
  if (warnings.length > 0) {
    const grnId = result.id;
    const grnWarnings = [...warnings];
    deferAfterResponse("grn-unit-mismatch:notify", () =>
      notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
        kind: "GENERIC",
        title: `GRN ${result.grnNo}: unit mismatch — stock not auto-updated`,
        body: grnWarnings.join(" "),
        link: `/procurement/grns/${grnId}`,
        dedupeKey: `grn-unit-mismatch:${grnId}`,
      }),
    );
  }

  revalidatePath("/procurement/grns");
  revalidatePath(`/procurement/purchase-orders/${input.poId}`);
  revalidatePath("/inventory/ingredients");
  return { ok: true, ...result, ...(warnings.length > 0 ? { warnings } : {}) };
}

/** Has anything been accepted against this PO? Drives the goods-in gate + its warning. */
export async function poHasReceivedGoods(poId: string): Promise<boolean> {
  await requireRole(READ_ROLES);
  const received = await db.gRN.count({
    where: { poId, status: { in: RECEIVED_GRN_STATUSES } },
  });
  return received > 0;
}
