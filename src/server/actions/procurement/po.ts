"use server";

/**
 * The purchase order. Raise, edit lines while it is still ours, submit, approve by
 * value (manager, then admin above the threshold), send to the vendor, recall, cancel,
 * and close — writing off whatever was never delivered.
 */

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import {
  BanquetRequisitionLineStatus,
  ChefRequisitionLineStatus,
  Prisma,
  ProcurementType,
  Role,
  VendorPOStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { ActionError, actionFailure, type ActionResult, type ActionResultWith } from "@/server/action-result";
import { deferAfterResponse } from "@/server/defer";
import { VendorPOCreateInput, VendorPOLinesUpdateInput } from "@/lib/validators";
import { computeLine, summarise } from "@/lib/gst";
import { humanizeStatus } from "@/lib/order-status";
import { closeRefusal, CLOSEABLE_PO_STATUSES } from "@/lib/vendor-po-gates";
import { indefineStateCode } from "@/lib/org";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { getSettingOr } from "@/lib/settings";
import { notifyRoles } from "@/server/notification-core";
import { createVendorPOTx } from "@/server/procurement-core";
import { recomputeBanquetReqStatus } from "@/server/banquet-core";
import { APPROVE_ROLES, recomputeChefReqStatusTx } from "./_shared";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];

/**
 * PO approval rule from the Workflow doc:
 *   Manager approval is always required.
 *   Admin approval is ALSO required when grandTotal ≥ adminMin.
 *
 * Stored as Setting key `po.approvalTiers`:
 *   { "adminMin": 5000 }
 *
 * Defaults to ₹5000 if the setting is missing — matches the doc's
 * "Procurement approval to be done by Admin >5000".
 */
interface PoApprovalTiers {
  /** PO grand total at-or-above which Admin approval is required. */
  adminMin: number;
}

async function loadApprovalTiers(): Promise<PoApprovalTiers> {
  const value = await getSettingOr<PoApprovalTiers>("po.approvalTiers", {
    adminMin: 5000,
  });
  // Defensive — Settings is JSON so callers could persist a malformed
  // shape. Fall back to defaults rather than throwing.
  const adminMin =
    typeof value?.adminMin === "number" && value.adminMin >= 0
      ? value.adminMin
      : 5000;
  return { adminMin };
}

/** Returns true when this PO total needs Admin approval on top of Manager. */
function needsAdminApproval(total: Decimal, tiers: PoApprovalTiers): boolean {
  return total.gte(tiers.adminMin);
}

/**
 * All procurement types follow the same value tier: under adminMin the
 * manager's sign-off completes the PO; at-or-above it the admin must also
 * sign. (Local/online purchases used to force double sign-off regardless
 * of value — dropped July 2026 per product decision: a ₹2,100 local veg
 * run shouldn't wait on the admin.)
 */
function typeForcesAdmin(): boolean {
  return false;
}

// =====================================================================
// VENDOR PO
// =====================================================================

export async function createVendorPO(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; poNo: string }>> {
  try {
    return await createVendorPOInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createVendorPOInner(raw: unknown): Promise<{ ok: true; id: string; poNo: string }> {
  // The store keeper raises the PO for a kitchen shortfall (vendor + goods,
  // prices pre-filled); the manager/admin then approves it by value. Admin
  // and manager can also raise one directly.
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER]);
  const input = VendorPOCreateInput.parse(raw);

  // Creation core is shared with the banquet "raise PO for shortfall" flow
  // (src/server/procurement-core.ts) — it validates ingredient/banquet-item
  // exclusivity, computes GST totals and audits VENDOR_PO_CREATED.
  const po = await db.$transaction(async (tx) =>
    createVendorPOTx(tx, session.user.id, input),
  );

  revalidatePath("/procurement/purchase-orders");
  return { ok: true, id: po.id, poNo: po.poNo };
}

/**
 * Edit the lines of a DRAFT PO in place — unit, quantity, price, GST and
 * description. The shortfall flow auto-creates POs with the catalogue unit
 * (e.g. "pkt") and its per-pkt cost, but the store keeper actually buys in
 * pieces — without this edit the total comes out wrong and can only be
 * fixed by cancelling and retyping the whole PO.
 *
 * Lines are UPDATED in place, never deleted/recreated:
 * BanquetRequisitionLine.vendorPOLineId and GRNLine reference these ids.
 * ingredientId / banquetItemId / sku / sortOrder are untouched. Line adds
 * and removes are out of scope. Per-line amounts are recomputed exactly
 * like createVendorPOTx; header totals via the same summarise() call.
 */
export async function updateVendorPOLines(raw: unknown): Promise<ActionResult> {
  try {
    return await updateVendorPOLinesInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function updateVendorPOLinesInner(raw: unknown): Promise<{ ok: true }> {
  // Same gate as createVendorPO — whoever can raise a PO can fix its draft.
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER]);
  const input = VendorPOLinesUpdateInput.parse(raw);

  await db.$transaction(async (tx) => {
    const po = await tx.vendorPO.findUnique({
      where: { id: input.poId },
      select: {
        id: true,
        status: true,
        poNo: true,
        grandTotal: true,
        placeOfSupplyStateCode: true,
        lines: { select: { id: true } },
      },
    });
    if (!po) throw new ActionError("PO not found");
    // Once submitted the totals are what approval signed off on — editing
    // them would sidestep the tiered approval. (The schema has no REJECTED
    // state; a rejected PO is CANCELLED, so DRAFT is the only editable one.)
    if (po.status !== VendorPOStatus.DRAFT) {
      throw new ActionError(`Only draft POs can be edited — this one is ${humanizeStatus(po.status)}.`);
    }
    const poLineIds = new Set(po.lines.map((l) => l.id));
    for (const l of input.lines) {
      if (!poLineIds.has(l.id)) {
        throw new ActionError("One of the edited lines doesn't belong to this PO — refresh the page.");
      }
    }

    // Per-line amounts: identical math to createVendorPOTx — both route
    // through gst.computeLine (per-line round then sum) so the header
    // summarise() and the stored line amounts share one rounding convention.
    for (const l of input.lines) {
      const { subtotal, tax, total } = computeLine({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPct: "0",
        gstRatePct: l.gstRatePct,
      });
      await tx.vendorPOLine.update({
        where: { id: l.id },
        data: {
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          gstRatePct: l.gstRatePct,
          lineSubtotal: subtotal.toString(),
          lineTax: tax.toString(),
          lineTotal: total.toString(),
        },
      });
    }

    // Header totals over ALL lines (edited + untouched), via the same
    // summarise() the creation core uses — so an edited PO's totals are
    // byte-for-byte what a fresh PO with these lines would carry.
    const linesNow = await tx.vendorPOLine.findMany({
      where: { poId: po.id },
      select: { quantity: true, unitPrice: true, gstRatePct: true },
    });
    const summary = summarise({
      lines: linesNow.map((l) => ({
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        discountPct: "0",
        gstRatePct: l.gstRatePct.toString(),
      })),
      supplierStateCode: indefineStateCode(),
      placeOfSupplyStateCode: po.placeOfSupplyStateCode,
    });

    // Status guard: a submit racing this edit loses cleanly — zero rows
    // match and the whole tx (including the line updates above) rolls back.
    const updated = await tx.vendorPO.updateMany({
      where: { id: po.id, status: VendorPOStatus.DRAFT },
      data: {
        subtotal: summary.subtotal.toString(),
        taxTotal: summary.taxTotal.toString(),
        grandTotal: summary.grandTotal.toString(),
      },
    });
    if (updated.count === 0) {
      throw new ActionError("This PO just changed status — refresh the page.");
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_PO_LINES_UPDATED",
        entity: "VendorPO",
        entityId: po.id,
        payloadHash: sha256Json({
          poNo: po.poNo,
          linesEdited: input.lines.length,
          grandTotalBefore: po.grandTotal.toString(),
          grandTotalAfter: summary.grandTotal.toString(),
        }),
      },
    });
  });

  revalidatePath(`/procurement/purchase-orders/${input.poId}`);
  revalidatePath("/procurement/purchase-orders");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function submitVendorPO(id: string): Promise<ActionResult> {
  try {
    return await submitVendorPOInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function submitVendorPOInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const result = await db.$transaction(async (tx) => {
    const po = await tx.vendorPO.findUnique({
      where: { id },
      select: {
        status: true,
        approvalTier: true,
        procurementType: true,
        poNo: true,
        grandTotal: true,
        vendor: { select: { name: true, approvalStatus: true } },
      },
    });
    if (!po) throw new ActionError("PO not found");
    if (po.status !== VendorPOStatus.DRAFT) {
      throw new ActionError("Only DRAFT POs can be submitted");
    }
    // Store-created vendors need manager/admin sign-off before an order is
    // placed with them. Drafting against a pending vendor is fine — this is
    // the point where the PO would actually go out, so it's the real gate.
    if (po.vendor.approvalStatus !== "APPROVED") {
      throw new ActionError(
        `"${po.vendor.name}" is still awaiting approval — a manager must approve the vendor before this PO can be submitted. The draft is saved.`,
      );
    }
    const nextStatus =
      po.approvalTier === "auto" ? VendorPOStatus.APPROVED : VendorPOStatus.PENDING_APPROVAL;
    // Status guard: a double-submit loses the race and gets a clear message.
    const updated = await tx.vendorPO.updateMany({
      where: { id, status: VendorPOStatus.DRAFT },
      data: {
        status: nextStatus,
        ...(po.approvalTier === "auto" ? { approvedByUserId: session.user.id, approvedAt: new Date() } : {}),
      },
    });
    if (updated.count === 0) {
      throw new ActionError("This PO was already submitted — refresh the page.");
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: po.approvalTier === "auto" ? "VENDOR_PO_AUTO_APPROVED" : "VENDOR_PO_SUBMITTED",
        entity: "VendorPO",
        entityId: id,
      },
    });
    return {
      status: nextStatus,
      poNo: po.poNo,
      grandTotal: po.grandTotal,
      vendorName: po.vendor.name,
      procurementType: po.procurementType,
    };
  });

  // Ping the approvers — the notification spells out it's a Purchase Order
  // and who needs to sign off, so the manager/admin knows what it's for.
  // Deferred: the submitter's button shouldn't wait on the fan-out.
  if (result.status === VendorPOStatus.PENDING_APPROVAL) {
    deferAfterResponse("po-submit:notify", async () => {
      const tiers = await loadApprovalTiers();
      const forcedByType = typeForcesAdmin();
      const adminRequired = needsAdminApproval(toDecimal(result.grandTotal), tiers) || forcedByType;
      const reason = forcedByType
        ? `${result.procurementType === ProcurementType.LOCAL ? "Local" : "Online"} procurement — Manager + Admin sign-off required.`
        : adminRequired
          ? "Over ₹5,000 — Admin sign-off required."
          : "Under ₹5,000 — Manager can approve.";
      await notifyRoles([Role.MANAGER, Role.ADMIN], {
        kind: "PO_AWAITING_ADMIN",
        title: `Purchase order ${result.poNo} needs approval`,
        body: `${result.vendorName} · ₹${toDecimal(result.grandTotal).toFixed(2)}. ${reason} Open Purchase orders to approve.`,
        link: `/procurement/purchase-orders/${id}`,
        dedupeKey: `po-awaiting:${id}`,
      });
    });
  }

  revalidatePath(`/procurement/purchase-orders/${id}`);
  return { ok: true };
}

/**
 * Two-step PO approval per the Workflow doc.
 *
 * Flow when approvalTier = "tiered":
 *   1. Manager (or Admin) clicks Approve  →  manager step recorded
 *      ─ If grandTotal < adminMin           →  status APPROVED (done)
 *      ─ If grandTotal ≥ adminMin           →  status stays
 *                                              PENDING_APPROVAL but
 *                                              UI shows "awaiting admin"
 *   2. Admin clicks Approve                →  admin step recorded,
 *                                              status APPROVED
 *
 * Admin can complete BOTH steps in one click on a fresh PO (their
 * approval implicitly satisfies the manager step too).
 *
 * Legacy approvalTier values ("manager" / "admin") are routed through
 * this tiered engine — no special casing.
 */
export async function approveVendorPO(id: string): Promise<ActionResult> {
  try {
    return await approveVendorPOInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function approveVendorPOInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(APPROVE_ROLES);
  await db.$transaction(async (tx) => {
    const po = await tx.vendorPO.findUnique({
      where: { id },
      select: {
        status: true,
        approvalTier: true,
        procurementType: true,
        grandTotal: true,
        managerApprovedAt: true,
        managerApprovedById: true,
      },
    });
    if (!po) throw new ActionError("PO not found");
    if (po.status !== VendorPOStatus.PENDING_APPROVAL) {
      throw new ActionError("PO is not awaiting approval");
    }

    const tiers = await loadApprovalTiers();
    // Local / online procurement always needs admin on top of manager.
    const adminRequired =
      needsAdminApproval(toDecimal(po.grandTotal), tiers) || typeForcesAdmin();
    const now = new Date();
    const role = session.user.role;

    const managerStepDone = po.managerApprovedAt != null;

    if (!managerStepDone) {
      // Manager step — Manager OR Admin can perform it.
      if (role !== Role.MANAGER && role !== Role.ADMIN) {
        throw new ActionError("Only Manager or Admin can approve");
      }
      const fullyApproved = !adminRequired || role === Role.ADMIN;
      // Approval-state guard: two approvers acting at once can't both
      // record the manager step — the loser matches zero rows.
      const updated = await tx.vendorPO.updateMany({
        where: { id, status: VendorPOStatus.PENDING_APPROVAL, managerApprovedAt: null },
        data: {
          managerApprovedById: session.user.id,
          managerApprovedAt: now,
          ...(role === Role.ADMIN && adminRequired
            ? { adminApprovedById: session.user.id, adminApprovedAt: now }
            : {}),
          ...(fullyApproved
            ? {
                status: VendorPOStatus.APPROVED,
                approvedByUserId: session.user.id,
                approvedAt: now,
              }
            : {}),
        },
      });
      if (updated.count === 0) {
        throw new ActionError("Someone just approved this PO — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: fullyApproved
            ? "VENDOR_PO_APPROVED"
            : "VENDOR_PO_MANAGER_APPROVED",
          entity: "VendorPO",
          entityId: id,
        },
      });
      return;
    }

    // Manager step already done. If the tier no longer demands admin (e.g.
    // the policy changed while this PO sat half-approved), any approver can
    // complete it; otherwise only the admin's signature closes it out.
    if (!adminRequired) {
      const completed = await tx.vendorPO.updateMany({
        where: { id, status: VendorPOStatus.PENDING_APPROVAL, managerApprovedAt: { not: null } },
        data: {
          status: VendorPOStatus.APPROVED,
          approvedByUserId: session.user.id,
          approvedAt: now,
        },
      });
      if (completed.count === 0) {
        throw new ActionError("Someone just approved this PO — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_PO_APPROVED",
          entity: "VendorPO",
          entityId: id,
        },
      });
      return;
    }
    if (role !== Role.ADMIN) {
      throw new ActionError(
        "This PO needs Admin approval (already approved by Manager).",
      );
    }
    const updated = await tx.vendorPO.updateMany({
      where: { id, status: VendorPOStatus.PENDING_APPROVAL, managerApprovedAt: { not: null } },
      data: {
        adminApprovedById: session.user.id,
        adminApprovedAt: now,
        status: VendorPOStatus.APPROVED,
        approvedByUserId: session.user.id,
        approvedAt: now,
      },
    });
    if (updated.count === 0) {
      throw new ActionError("Someone just approved this PO — refresh the page.");
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_PO_ADMIN_APPROVED",
        entity: "VendorPO",
        entityId: id,
      },
    });
  });

  // ---- notifications, after the response (best-effort) ----
  // Re-load the PO so we can find out whether the manager-approval
  // step ended fully approved or still awaiting admin.
  deferAfterResponse("po-approve:notify", async () => {
    const after = await db.vendorPO.findUnique({
      where: { id },
      select: {
        poNo: true,
        status: true,
        managerApprovedAt: true,
        adminApprovedAt: true,
      },
    });
    if (!after) return;
    if (after.status === VendorPOStatus.APPROVED) {
      // Final approval — notify the Store team so they can send the PO.
      await notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
        kind: "PO_APPROVED",
        title: `PO ${after.poNo} approved`,
        body: "Send to vendor + record GRN when goods arrive.",
        link: `/procurement/purchase-orders/${id}`,
        dedupeKey: `po-approved:${id}`,
      });
    } else if (
      after.status === VendorPOStatus.PENDING_APPROVAL &&
      after.managerApprovedAt &&
      !after.adminApprovedAt
    ) {
      // Mid-tier — notify Admins so they know an approval awaits them.
      await notifyRoles([Role.ADMIN], {
        kind: "PO_AWAITING_ADMIN",
        title: `PO ${after.poNo} awaits Admin approval`,
        body: "Manager has signed off. Final sign-off needed.",
        link: `/procurement/purchase-orders/${id}`,
        dedupeKey: `po-awaiting-admin:${id}`,
      });
    }
  });

  revalidatePath(`/procurement/purchase-orders/${id}`);
  revalidatePath("/procurement/purchase-orders");
  return { ok: true };
}

export async function sendVendorPO(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    await db.$transaction(async (tx) => {
      const po = await tx.vendorPO.findUnique({ where: { id }, select: { status: true } });
      if (!po) throw new ActionError("PO not found");
      if (po.status !== VendorPOStatus.APPROVED) {
        throw new ActionError("Only APPROVED POs can be sent");
      }
      // Status guard: a double-click loses the race with a clear message.
      const updated = await tx.vendorPO.updateMany({
        where: { id, status: VendorPOStatus.APPROVED },
        data: { status: VendorPOStatus.SENT, sentAt: new Date() },
      });
      if (updated.count === 0) {
        throw new ActionError("This PO was already marked sent — refresh the page.");
      }
      await tx.auditLog.create({
        data: { userId: session.user.id, action: "VENDOR_PO_SENT", entity: "VendorPO", entityId: id },
      });
    });
    revalidatePath(`/procurement/purchase-orders/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Requisition lines this PO was buying for that are still waiting on goods
 * it is never going to deliver: flip them back to PENDING (dropping the
 * dangling PO-line link) and roll their parent requisition status back, so
 * the store can raise a fresh PO. Shared by cancel and close — a retired PO
 * strands the same lines whichever verb retired it.
 */
async function unstrandRequisitionLines(
  tx: Prisma.TransactionClient,
  lineIds: string[],
  userId: string,
): Promise<{
  banquetReqIds: string[];
  chefReqs: Array<{ reqId: string; requisitionNo: string }>;
}> {
  if (lineIds.length === 0) return { banquetReqIds: [], chefReqs: [] };

  const reqLines = await tx.banquetRequisitionLine.findMany({
    where: {
      vendorPOLineId: { in: lineIds },
      status: BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
    },
    select: { id: true, requisitionId: true },
  });
  if (reqLines.length) {
    await tx.banquetRequisitionLine.updateMany({
      where: { id: { in: reqLines.map((l) => l.id) } },
      data: { status: BanquetRequisitionLineStatus.PENDING, vendorPOLineId: null },
    });
    for (const reqId of new Set(reqLines.map((l) => l.requisitionId))) {
      await recomputeBanquetReqStatus(tx, reqId, userId);
    }
  }

  // Same treatment for chef requisition lines (M16 link).
  const chefReqLines = await tx.chefRequisitionLine.findMany({
    where: {
      vendorPOLineId: { in: lineIds },
      status: ChefRequisitionLineStatus.AWAITING_PROCUREMENT,
    },
    select: {
      id: true,
      requisitionId: true,
      requisition: { select: { requisitionNo: true } },
    },
  });
  if (chefReqLines.length) {
    await tx.chefRequisitionLine.updateMany({
      where: { id: { in: chefReqLines.map((l) => l.id) } },
      data: { status: ChefRequisitionLineStatus.PENDING, vendorPOLineId: null },
    });
    for (const reqId of new Set(chefReqLines.map((l) => l.requisitionId))) {
      await recomputeChefReqStatusTx(tx, reqId, userId);
    }
  }

  return {
    banquetReqIds: [...new Set(reqLines.map((l) => l.requisitionId))],
    chefReqs: [
      ...new Map(
        chefReqLines.map((l) => [l.requisitionId, l.requisition.requisitionNo]),
      ).entries(),
    ].map(([reqId, requisitionNo]) => ({ reqId, requisitionNo })),
  };
}

/**
 * Post-commit half of the un-strand: refresh the requisition screens and
 * tell the store which requisitions dropped back to pending. The banquet
 * un-strand is silent (no cancellation notification existed to fold into),
 * the chef one isn't.
 */
function announceUnstrand(
  poId: string,
  affected: Awaited<ReturnType<typeof unstrandRequisitionLines>>,
  why: string,
) {
  for (const reqId of affected.banquetReqIds) {
    revalidatePath(`/banquet/requisitions/${reqId}`);
  }
  if (!affected.chefReqs.length) return;
  for (const { reqId } of affected.chefReqs) revalidatePath(`/requisitions/${reqId}`);
  revalidatePath("/requisitions");
  revalidatePath("/queue/issuing");
  const crNumbers = affected.chefReqs.map((r) => r.requisitionNo);
  const many = crNumbers.length > 1;
  deferAfterResponse("po-unstrand-chefreq:notify", () =>
    notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
      kind: "GENERIC",
      title: `Re-raise procurement for ${crNumbers.join(", ")}`,
      body: `${why} — ${many ? "requisitions" : "requisition"} ${crNumbers.join(", ")} ${many ? "are" : "is"} back to pending and ${many ? "need" : "needs"} a fresh PO.`,
      link: "/requisitions",
      dedupeKey: `po-unstrand-chefreq:${poId}`,
    }),
  );
}

export async function cancelVendorPO(id: string, reason: string): Promise<ActionResult> {
  try {
    // The store keeper (who raises POs) may cancel one that hasn't left the
    // building yet — DRAFT or PENDING_APPROVAL. Once it's approved/sent/
    // received, only a manager/admin can cancel (goods and bills are in play).
    const session = await requireRole(WRITE_ROLES);
    if (!reason.trim()) throw new ActionError("Reason required");
    const affectedReqs = await db.$transaction(async (tx) => {
      const po = await tx.vendorPO.findUnique({
        where: { id },
        select: { status: true, lines: { select: { id: true } } },
      });
      if (!po) throw new ActionError("Purchase order not found");
      if (po.status === VendorPOStatus.CANCELLED) throw new ActionError("This PO is already cancelled.");
      if (po.status === VendorPOStatus.CLOSED || po.status === VendorPOStatus.RECEIVED) {
        throw new ActionError("This PO is already received/closed — it can't be cancelled.");
      }
      const storeKeeperOnly = session.user.role === Role.STORE_KEEPER;
      if (
        storeKeeperOnly &&
        po.status !== VendorPOStatus.DRAFT &&
        po.status !== VendorPOStatus.PENDING_APPROVAL
      ) {
        throw new ActionError(
          "This PO has already gone to the vendor — ask a manager/admin to cancel it.",
        );
      }

      await tx.vendorPO.update({
        where: { id },
        data: { status: VendorPOStatus.CANCELLED, closedAt: new Date(), notes: reason },
      });

      // Un-strand the requisition lines this dead PO was buying for — else
      // they sit AWAITING_PROCUREMENT pointing at a PO line nothing will
      // ever arrive against.
      const unstranded = await unstrandRequisitionLines(
        tx,
        po.lines.map((l) => l.id),
        session.user.id,
      );

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_PO_CANCELLED",
          entity: "VendorPO",
          entityId: id,
          payloadHash: sha256Json({ reason }),
        },
      });
      return unstranded;
    });
    revalidatePath(`/procurement/purchase-orders/${id}`);
    revalidatePath("/procurement/purchase-orders");
    revalidatePath("/dashboard");
    announceUnstrand(id, affectedReqs, "PO cancelled");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Retire a purchase order. CLOSED existed in the enum and in half a dozen
 * "still open" queries, but nothing ever set it — so POs accumulated with no
 * way to finish one, including the ordinary case of a supplier who simply
 * cannot deliver the rest.
 *
 * ADMIN/MANAGER only. Closing writes off whatever the supplier still owes
 * us — the same weight as approving or cancelling the PO, which is why it
 * shares APPROVE_ROLES. Accounts are deliberately not on this list: their
 * authority is over the bill, not over declaring the order finished, and the
 * gates below already protect the payables desk by refusing to close over
 * money that hasn't been billed or settled.
 *
 * A reason is required and lands on the PO (readably — AuditLog only keeps a
 * hash), because on a PARTIALLY_RECEIVED PO this is a write-off decision.
 */
export async function closeVendorPO(id: string, reason: string): Promise<ActionResult> {
  try {
    const session = await requireRole(APPROVE_ROLES);
    if (!reason.trim()) throw new ActionError("Say why this PO is being closed.");
    const affectedReqs = await db.$transaction(async (tx) => {
      const po = await tx.vendorPO.findUnique({
        where: { id },
        select: {
          poNo: true,
          status: true,
          lines: { select: { id: true, receivedQty: true } },
          bills: { select: { billNo: true, status: true } },
        },
      });
      if (!po) throw new ActionError("Purchase order not found");
      const refusal = closeRefusal({
        poNo: po.poNo,
        status: po.status,
        anythingReceived: po.lines.some((l) => toDecimal(l.receivedQty).gt(0)),
        bills: po.bills,
      });
      if (refusal) throw new ActionError(refusal);

      // Status guard: a receipt or a cancellation racing this close loses
      // cleanly rather than closing a PO that just moved on.
      const updated = await tx.vendorPO.updateMany({
        where: { id, status: { in: CLOSEABLE_PO_STATUSES } },
        data: { status: VendorPOStatus.CLOSED, closedAt: new Date(), notes: reason },
      });
      if (updated.count === 0) {
        throw new ActionError("This PO just changed status — refresh the page.");
      }

      // The undelivered balance is never coming, so anything still waiting
      // on it goes back to the store to source another way.
      const unstranded = await unstrandRequisitionLines(
        tx,
        po.lines.map((l) => l.id),
        session.user.id,
      );

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_PO_CLOSED",
          entity: "VendorPO",
          entityId: id,
          payloadHash: sha256Json({ reason }),
        },
      });
      return unstranded;
    });
    revalidatePath(`/procurement/purchase-orders/${id}`);
    revalidatePath("/procurement/purchase-orders");
    revalidatePath("/dashboard");
    announceUnstrand(id, affectedReqs, "PO closed");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Recall a PENDING_APPROVAL PO back to DRAFT so it can be edited before it
 * goes to the vendor. Whoever can raise a PO can recall it — the store keeper
 * uses this to fix a wrong unit/price they only spotted after submitting.
 * Approval stamps are cleared so it re-enters the queue cleanly on resubmit.
 */
export async function recallVendorPOToDraft(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    await db.$transaction(async (tx) => {
      const updated = await tx.vendorPO.updateMany({
        where: { id, status: VendorPOStatus.PENDING_APPROVAL },
        data: {
          status: VendorPOStatus.DRAFT,
          managerApprovedById: null,
          managerApprovedAt: null,
          adminApprovedById: null,
          adminApprovedAt: null,
          approvedByUserId: null,
          approvedAt: null,
        },
      });
      if (updated.count === 0) {
        const po = await tx.vendorPO.findUnique({ where: { id }, select: { status: true } });
        throw new ActionError(
          `Only a PO awaiting approval can be recalled — this one is ${po ? humanizeStatus(po.status) : "gone"}.`,
        );
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_PO_RECALLED_TO_DRAFT",
          entity: "VendorPO",
          entityId: id,
        },
      });
    });
    revalidatePath(`/procurement/purchase-orders/${id}`);
    revalidatePath("/procurement/purchase-orders");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}
