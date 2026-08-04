"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import {
  BanquetRequisitionLineStatus,
  BanquetRequisitionStatus,
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  GRNStatus,
  PaymentMethod,
  Prisma,
  ProcurementType,
  Role,
  VendorBillStatus,
  VendorPOStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import { deferAfterResponse } from "@/server/defer";
import {
  GRNCreateInput,
  VendorBillCreateInput,
  VendorBillUpdateInput,
  VendorPOCreateInput,
  VendorPOLinesUpdateInput,
  type VendorBillLineInputT,
} from "@/lib/validators";
import { computeLine, summarise } from "@/lib/gst";
import { humanizeStatus } from "@/lib/order-status";
import { indefineStateCode } from "@/lib/org";
import { nextGRNNumber, nextVendorBillNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { newMovingAverage } from "@/lib/inventory-cost";
import { unitsEquivalent } from "@/lib/units";
import { toDecimal } from "@/lib/money";
import { getSettingOr } from "@/lib/settings";
import { createNotification, notifyRoles } from "@/server/notification-core";
import { createVendorPOTx } from "@/server/procurement-core";
import { lockBanquetItemRows, recomputeBanquetReqStatus } from "@/server/banquet-core";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];
// Store keeper records the vendor's invoice at goods-in (they hold the
// physical bill) and can 3-way match it; approve + pay stay finance-only
// (APPROVE_ROLES / the payment gate).
const BILL_WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.STORE_KEEPER];
const APPROVE_ROLES = [Role.ADMIN, Role.MANAGER];
// Supplier-bill approval additionally includes accounts (client item #12) —
// they run the payables desk. PO approval above stays management-only.
const BILL_APPROVE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];
const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS, Role.KITCHEN_HEAD];

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

      // Un-strand any banquet requisition lines this PO was buying: flip them
      // back to PENDING so the store can raise a fresh PO (else they'd sit
      // AWAITING_PROCUREMENT pointing at a dead PO line).
      const lineIds = po.lines.map((l) => l.id);
      const reqLines = lineIds.length
        ? await tx.banquetRequisitionLine.findMany({
            where: { vendorPOLineId: { in: lineIds }, status: BanquetRequisitionLineStatus.AWAITING_PROCUREMENT },
            select: { id: true, requisitionId: true },
          })
        : [];
      if (reqLines.length) {
        await tx.banquetRequisitionLine.updateMany({
          where: { id: { in: reqLines.map((l) => l.id) } },
          data: { status: BanquetRequisitionLineStatus.PENDING, vendorPOLineId: null },
        });
        for (const reqId of new Set(reqLines.map((l) => l.requisitionId))) {
          await recomputeBanquetReqStatus(tx, reqId, session.user.id);
        }
      }

      // Mirror the banquet un-strand for chef requisition lines (M16 link):
      // flip the AWAITING_PROCUREMENT lines this dead PO was buying for back
      // to PENDING (dropping the dangling PO-line link) and roll their parent
      // requisition status back, so the store can re-raise procurement.
      const chefReqLines = lineIds.length
        ? await tx.chefRequisitionLine.findMany({
            where: {
              vendorPOLineId: { in: lineIds },
              status: ChefRequisitionLineStatus.AWAITING_PROCUREMENT,
            },
            select: {
              id: true,
              requisitionId: true,
              requisition: { select: { requisitionNo: true } },
            },
          })
        : [];
      if (chefReqLines.length) {
        await tx.chefRequisitionLine.updateMany({
          where: { id: { in: chefReqLines.map((l) => l.id) } },
          data: { status: ChefRequisitionLineStatus.PENDING, vendorPOLineId: null },
        });
        for (const reqId of new Set(chefReqLines.map((l) => l.requisitionId))) {
          await recomputeChefReqStatusTx(tx, reqId, session.user.id);
        }
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_PO_CANCELLED",
          entity: "VendorPO",
          entityId: id,
          payloadHash: sha256Json({ reason }),
        },
      });
      const chefReqs = [
        ...new Map(
          chefReqLines.map((l) => [l.requisitionId, l.requisition.requisitionNo]),
        ).entries(),
      ].map(([reqId, requisitionNo]) => ({ reqId, requisitionNo }));
      return {
        banquetReqIds: [...new Set(reqLines.map((l) => l.requisitionId))],
        chefReqs,
      };
    });
    revalidatePath(`/procurement/purchase-orders/${id}`);
    revalidatePath("/procurement/purchase-orders");
    revalidatePath("/dashboard");
    for (const reqId of affectedReqs.banquetReqIds) {
      revalidatePath(`/banquet/requisitions/${reqId}`);
    }
    if (affectedReqs.chefReqs.length) {
      for (const { reqId } of affectedReqs.chefReqs) revalidatePath(`/requisitions/${reqId}`);
      revalidatePath("/requisitions");
      revalidatePath("/queue/issuing");
      // No cancellation notification existed to fold into (the banquet
      // un-strand above is silent), so tell the store which requisitions
      // dropped back to pending and need a fresh PO.
      const crNumbers = affectedReqs.chefReqs.map((r) => r.requisitionNo);
      const many = crNumbers.length > 1;
      deferAfterResponse("po-cancel-chefreq:notify", () =>
        notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
          kind: "GENERIC",
          title: `Re-raise procurement for ${crNumbers.join(", ")}`,
          body: `PO cancelled — ${many ? "requisitions" : "requisition"} ${crNumbers.join(", ")} ${many ? "are" : "is"} back to pending and ${many ? "need" : "needs"} a fresh PO.`,
          link: "/requisitions",
          dedupeKey: `po-cancel-chefreq:${id}`,
        }),
      );
    }
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

/**
 * Recompute a chef requisition's rolled-up status after a GRN flips lines
 * back from AWAITING_PROCUREMENT to PENDING. Same semantics as the issue
 * path in chef-requisitions.ts: any issued progress → PARTIALLY_ISSUED,
 * otherwise SUBMITTED. FULLY_ISSUED is unreachable here (the flipped line
 * is PENDING), and the status guard keeps terminal requisitions
 * (CANCELLED / FULLY_ISSUED) untouched.
 */
async function recomputeChefReqStatusTx(
  tx: Prisma.TransactionClient,
  reqId: string,
  userId: string,
) {
  const lines = await tx.chefRequisitionLine.findMany({
    where: { requisitionId: reqId },
    select: { status: true },
  });
  const anyProgress = lines.some(
    (l) =>
      l.status === ChefRequisitionLineStatus.ISSUED ||
      l.status === ChefRequisitionLineStatus.PARTIALLY_ISSUED,
  );
  await tx.chefRequisition.updateMany({
    where: {
      id: reqId,
      status: { in: [ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED] },
    },
    data: {
      status: anyProgress ? ChefRequisitionStatus.PARTIALLY_ISSUED : ChefRequisitionStatus.SUBMITTED,
      lastFulfilledById: userId,
    },
  });
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
    const ok =
      po.status === VendorPOStatus.APPROVED ||
      po.status === VendorPOStatus.SENT ||
      po.status === VendorPOStatus.PARTIALLY_RECEIVED;
    if (!ok) throw new ActionError("PO must be approved/sent before receiving goods");

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

    // H1: lock every ingredient this GRN will post stock to, up front and in
    // a stable (sorted) order — concurrent GRNs touching the same ingredients
    // can't deadlock and can't lose each other's moving-average update. The
    // catalogue snapshot is re-read under the lock at the compute site below.
    const ingredientLockIds = new Set<string>();
    for (const li of input.lines) {
      const pl = po.lines.find((l) => l.id === li.poLineId);
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

    for (let i = 0; i < input.lines.length; i++) {
      const lineInput = input.lines[i];
      const poLine = po.lines.find((l) => l.id === lineInput.poLineId);
      if (!poLine) throw new ActionError("PO line not found");

      // M7: use the receivedQty re-read under the row lock, not the stale
      // include snapshot (fallback keeps a non-PO line failing the find below).
      const freshReceivedQty = receivedQtyById.get(poLine.id) ?? poLine.receivedQty;
      const orderedRemaining = toDecimal(poLine.quantity).minus(toDecimal(freshReceivedQty));
      const accepted = toDecimal(lineInput.acceptedQty);
      const rejected = toDecimal(lineInput.rejectedQty ?? "0");
      if (accepted.plus(rejected).gt(orderedRemaining)) {
        throw new ActionError(
          `Cannot receive ${accepted.plus(rejected).toString()} of "${poLine.description}" — only ${orderedRemaining.toString()} remaining on PO`,
        );
      }
      if (accepted.lt(0) || rejected.lt(0)) throw new ActionError("Quantities must be non-negative");

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

    // Recompute PO status
    const poLinesNow = await tx.vendorPOLine.findMany({ where: { poId: po.id } });
    const allReceived = poLinesNow.every((l) => toDecimal(l.receivedQty).gte(toDecimal(l.quantity)));
    const newPoStatus = allReceived ? VendorPOStatus.RECEIVED : VendorPOStatus.PARTIALLY_RECEIVED;

    await tx.gRN.update({ where: { id: grn.id }, data: { status: newGrnStatus } });
    await tx.vendorPO.update({ where: { id: po.id }, data: { status: newPoStatus } });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "GRN_CREATED",
        entity: "GRN",
        entityId: grn.id,
        payloadHash: sha256Json({ poId: po.id, lines: input.lines.length }),
      },
    });

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

// =====================================================================
// VENDOR BILL + 3-WAY MATCH
// =====================================================================

const PRICE_TOLERANCE_PCT = new Decimal(0.5); // ±0.5%
const TAX_TOLERANCE_ABS = new Decimal(1); // ±₹1

export async function createVendorBill(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; billNo: string }>> {
  try {
    return await createVendorBillInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Compute line rows + totals for a vendor bill. Single source of truth
 * shared by createVendorBill and updateVendorBill so an edited bill's
 * totals are recomputed exactly the way they were at creation.
 */
function computeVendorBillLines(lines: VendorBillLineInputT[]) {
  let subtotal = new Decimal(0);
  let taxTotal = new Decimal(0);
  const linesData = lines.map((l, idx) => {
    // decimalString lets "" through (legitimate "not provided" elsewhere),
    // and `?? "0"` only catches null — so a blank GST/qty/price box reached
    // new Decimal("") and crashed with a raw [DecimalError] on Create draft
    // bill. Same blank-guards as the PO path: qty/price must be entered
    // (0 price is fine), blank GST means 0%.
    const quantity = l.quantity.trim();
    if (!quantity) throw new ActionError(`Line "${l.description}": enter the quantity.`);
    const unitPrice = l.unitPrice.trim();
    if (!unitPrice) throw new ActionError(`Line "${l.description}": enter the unit price (0 is fine).`);
    const gstRatePct = l.gstRatePct?.trim() || "0";
    // Per-line round then sum via gst.computeLine, so the header totals are
    // the sum of the rounded lines (matching summarise / the PO convention)
    // rather than a single rounding of the raw sum.
    const { subtotal: lineSub, tax: lineTax, total: lineTotal } = computeLine({
      quantity,
      unitPrice,
      discountPct: "0",
      gstRatePct,
    });
    subtotal = subtotal.plus(lineSub);
    taxTotal = taxTotal.plus(lineTax);
    return {
      sortOrder: idx,
      description: l.description,
      quantity,
      unit: l.unit,
      unitPrice,
      gstRatePct,
      lineSubtotal: lineSub.toString(),
      lineTax: lineTax.toString(),
      lineTotal: lineTotal.toString(),
    };
  });
  return { linesData, subtotal, taxTotal };
}

async function createVendorBillInner(raw: unknown): Promise<{ ok: true; id: string; billNo: string }> {
  const session = await requireRole(BILL_WRITE_ROLES);
  const input = VendorBillCreateInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const { linesData, subtotal, taxTotal } = computeVendorBillLines(input.lines);

    const billNo = await nextVendorBillNumber(tx);
    const bill = await tx.vendorBill.create({
      data: {
        billNo,
        vendorBillNo: input.vendorBillNo ?? null,
        vendorId: input.vendorId,
        poId: input.poId ?? null,
        status: VendorBillStatus.DRAFT,
        issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        subtotal: subtotal.toDecimalPlaces(2).toString(),
        taxTotal: taxTotal.toDecimalPlaces(2).toString(),
        grandTotal: subtotal.plus(taxTotal).toDecimalPlaces(2).toString(),
        notes: input.notes ?? null,
        lines: { create: linesData },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_BILL_CREATED",
        entity: "VendorBill",
        entityId: bill.id,
        payloadHash: sha256Json({ billNo, vendorId: input.vendorId, poId: input.poId ?? null }),
      },
    });
    return bill;
  });

  revalidatePath("/procurement/vendor-bills");
  return { ok: true, id: result.id, billNo: result.billNo };
}

/**
 * Edit a supplier bill that hasn't been approved yet — DRAFT, PENDING_MATCH,
 * or DISCREPANCY (a match that failed on a keying error, H6). Approved / paid
 * bills are financial records and stay immutable. Editable fields:
 * vendorBillNo, issue/due dates, notes and the lines (full replace, totals
 * recomputed via the same computation createVendorBill uses). Any previous
 * match result is stale after an edit, so the match fields — and the status —
 * are reset to the same clean DRAFT state createVendorBill initialises them
 * with, which also lifts a DISCREPANCY bill out of its dead end.
 */
export async function updateVendorBill(id: string, raw: unknown): Promise<ActionResult> {
  try {
    return await updateVendorBillInner(id, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function updateVendorBillInner(id: string, raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(BILL_WRITE_ROLES);
  const input = VendorBillUpdateInput.parse(raw);

  await db.$transaction(async (tx) => {
    const bill = await tx.vendorBill.findUnique({
      where: { id },
      select: { status: true, billNo: true },
    });
    if (!bill) throw new ActionError("Bill not found");
    // H6: DISCREPANCY is editable too — a match that failed on a keying error
    // was otherwise a dead end (no VOID, no delete). Editing clears the stale
    // match result and drops the bill back to DRAFT so it can be re-matched.
    if (
      bill.status !== VendorBillStatus.DRAFT &&
      bill.status !== VendorBillStatus.PENDING_MATCH &&
      bill.status !== VendorBillStatus.DISCREPANCY
    ) {
      throw new ActionError(
        `${bill.billNo} is ${humanizeStatus(bill.status)} — approved/paid bills are financial records and can't be edited. Record a fresh bill or contact an admin.`,
      );
    }

    const { linesData, subtotal, taxTotal } = computeVendorBillLines(input.lines);

    // Status guard: someone running the 3-way match (or a payment) while
    // this edit is in flight loses the race with a clear message.
    const updated = await tx.vendorBill.updateMany({
      where: {
        id,
        status: {
          in: [VendorBillStatus.DRAFT, VendorBillStatus.PENDING_MATCH, VendorBillStatus.DISCREPANCY],
        },
      },
      data: {
        vendorBillNo: input.vendorBillNo ?? null,
        ...(input.issueDate ? { issueDate: new Date(input.issueDate) } : {}),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        notes: input.notes ?? null,
        subtotal: subtotal.toDecimalPlaces(2).toString(),
        taxTotal: taxTotal.toDecimalPlaces(2).toString(),
        grandTotal: subtotal.plus(taxTotal).toDecimalPlaces(2).toString(),
        // The lines changed, so any earlier match result is stale — reset to
        // the same clean state a freshly created bill has (DRAFT), which also
        // lifts a DISCREPANCY bill out of its dead end so it re-enters matching.
        status: VendorBillStatus.DRAFT,
        matchedByUserId: null,
        matchedAt: null,
        discrepancyNote: null,
      },
    });
    if (updated.count === 0) {
      throw new ActionError("This bill just changed status — refresh the page.");
    }

    // Full line replace, same as the customer-invoice draft editor.
    await tx.vendorBillLine.deleteMany({ where: { billId: id } });
    await tx.vendorBillLine.createMany({
      data: linesData.map((l) => ({ ...l, billId: id })),
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_BILL_UPDATED",
        entity: "VendorBill",
        entityId: id,
        payloadHash: sha256Json({
          billNo: bill.billNo,
          lines: input.lines.length,
          grandTotal: subtotal.plus(taxTotal).toDecimalPlaces(2).toString(),
        }),
      },
    });
  });

  revalidatePath("/procurement/vendor-bills");
  revalidatePath(`/procurement/vendor-bills/${id}`);
  return { ok: true };
}

interface Discrepancy {
  line: string;
  field: "qty" | "price" | "tax" | "match";
  poValue?: string;
  billValue: string;
  delta?: string;
}

/**
 * 3-way match: compare bill lines to PO + GRN-accepted qty.
 *   - For each bill line, find the closest PO line by description (fuzzy
 *     match: starts-with or contains).
 *   - Bill qty must equal GRN accepted qty for that PO line (within
 *     zero tolerance — line-level).
 *   - Bill unit price must match PO unit price within ±0.5%.
 *   - Bill tax amount must match PO tax within ±₹1.
 * Sets status MATCHED on success, DISCREPANCY with discrepancyNote otherwise.
 */
export async function matchVendorBill(
  id: string,
): Promise<ActionResultWith<{ matched: boolean; discrepancies: Discrepancy[] }>> {
  try {
    return await matchVendorBillInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function matchVendorBillInner(
  id: string,
): Promise<{ ok: true; matched: boolean; discrepancies: Discrepancy[] }> {
  const session = await requireRole(BILL_WRITE_ROLES);
  return db.$transaction(async (tx) => {
    const bill = await tx.vendorBill.findUnique({
      where: { id },
      include: {
        lines: true,
        po: { include: { lines: { include: { ingredient: true } } } },
      },
    });
    if (!bill) throw new ActionError("Bill not found");
    if (!bill.po) throw new ActionError("Bill has no linked PO — can't 3-way match");

    // M10: matching is only for bills still in the pre-approval pipeline.
    // Re-running it against an APPROVED/PAID (or OVERDUE) bill would demote a
    // settled record back to MATCHED/DISCREPANCY — refuse it.
    const MATCHABLE: VendorBillStatus[] = [
      VendorBillStatus.DRAFT,
      VendorBillStatus.PENDING_MATCH,
      VendorBillStatus.MATCHED,
      VendorBillStatus.DISCREPANCY,
    ];
    if (!MATCHABLE.includes(bill.status)) {
      throw new ActionError("This bill is already approved/paid — matching is locked.");
    }

    const discrepancies: Discrepancy[] = [];

    for (const billLine of bill.lines) {
      const poLine = bill.po.lines.find(
        (l) =>
          l.description.toLowerCase() === billLine.description.toLowerCase() ||
          l.description.toLowerCase().includes(billLine.description.toLowerCase()) ||
          billLine.description.toLowerCase().includes(l.description.toLowerCase()),
      );
      if (!poLine) {
        discrepancies.push({ line: billLine.description, field: "match", billValue: "no PO line match" });
        continue;
      }
      // Qty: compare to GRN-accepted quantity (POLine.receivedQty)
      const billQty = toDecimal(billLine.quantity);
      const acceptedQty = toDecimal(poLine.receivedQty);
      if (!billQty.eq(acceptedQty)) {
        discrepancies.push({
          line: billLine.description,
          field: "qty",
          poValue: acceptedQty.toString(),
          billValue: billQty.toString(),
          delta: billQty.minus(acceptedQty).toString(),
        });
      }
      // Price tolerance
      const poPrice = toDecimal(poLine.unitPrice);
      const billPrice = toDecimal(billLine.unitPrice);
      const tol = poPrice.times(PRICE_TOLERANCE_PCT).div(100).abs();
      if (billPrice.minus(poPrice).abs().gt(tol)) {
        discrepancies.push({
          line: billLine.description,
          field: "price",
          poValue: poPrice.toString(),
          billValue: billPrice.toString(),
          delta: billPrice.minus(poPrice).toString(),
        });
      }
      // Tax tolerance (₹1)
      const poTax = toDecimal(poLine.lineTax);
      const billTax = toDecimal(billLine.lineTax);
      if (billTax.minus(poTax).abs().gt(TAX_TOLERANCE_ABS)) {
        discrepancies.push({
          line: billLine.description,
          field: "tax",
          poValue: poTax.toString(),
          billValue: billTax.toString(),
          delta: billTax.minus(poTax).toString(),
        });
      }
    }

    const matched = discrepancies.length === 0;
    // M10: guard the write too — an approve/pay racing this match loses
    // cleanly (zero rows) instead of clobbering the settled status.
    const updated = await tx.vendorBill.updateMany({
      where: { id, status: { in: MATCHABLE } },
      data: {
        status: matched ? VendorBillStatus.MATCHED : VendorBillStatus.DISCREPANCY,
        matchedByUserId: matched ? session.user.id : null,
        matchedAt: matched ? new Date() : null,
        discrepancyNote: matched ? null : JSON.stringify(discrepancies),
      },
    });
    if (updated.count === 0) {
      throw new ActionError("This bill just changed status — refresh the page.");
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: matched ? "VENDOR_BILL_MATCHED" : "VENDOR_BILL_DISCREPANCY",
        entity: "VendorBill",
        entityId: id,
        payloadHash: sha256Json({ discrepancies: discrepancies.length }),
      },
    });

    revalidatePath(`/procurement/vendor-bills/${id}`);
    return { ok: true as const, matched, discrepancies };
  });
}

export async function approveVendorBill(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(BILL_APPROVE_ROLES);
    await db.$transaction(async (tx) => {
      const bill = await tx.vendorBill.findUnique({ where: { id }, select: { status: true } });
      if (!bill) throw new ActionError("Bill not found");
      if (bill.status !== VendorBillStatus.MATCHED && bill.status !== VendorBillStatus.DISCREPANCY) {
        throw new ActionError(`Cannot approve a bill that's ${humanizeStatus(bill.status)}`);
      }
      // Status guard: a double-approve loses the race with a clear message.
      const updated = await tx.vendorBill.updateMany({
        where: { id, status: { in: [VendorBillStatus.MATCHED, VendorBillStatus.DISCREPANCY] } },
        data: { status: VendorBillStatus.APPROVED },
      });
      if (updated.count === 0) {
        throw new ActionError("This bill was already approved — refresh the page.");
      }
      await tx.auditLog.create({
        data: { userId: session.user.id, action: "VENDOR_BILL_APPROVED", entity: "VendorBill", entityId: id },
      });
    });
    revalidatePath(`/procurement/vendor-bills/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * One-click "Mark paid" for a vendor bill — records a single
 * VendorBillPayment for the outstanding balance, method `OTHER`,
 * note "Marked paid". For richer cases (TDS, split payments) use the
 * existing BillPaymentForm.
 */
export async function markVendorBillPaid(input: {
  id: string;
  method: PaymentMethod;
  reference?: string | null;
  paidAt?: string | null;
  notes?: string | null;
}): Promise<ActionResult> {
  try {
    return await markVendorBillPaidInner(input);
  } catch (err) {
    return actionFailure(err);
  }
}

async function markVendorBillPaidInner(input: {
  id: string;
  method: PaymentMethod;
  reference?: string | null;
  paidAt?: string | null;
  notes?: string | null;
}): Promise<{ ok: true }> {
  // Vendor side: accounts is the one who actually pays the supplier,
  // so they get the mark-paid action (plus admin/manager). Customer
  // side stays admin/manager only — see markCustomerInvoicePaid.
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const { id } = input;
  const paidAtDate = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAtDate.getTime())) {
    throw new ActionError("paidAt is not a valid date");
  }
  await db.$transaction(async (tx) => {
    const bill = await tx.vendorBill.findUnique({
      where: { id },
      select: { id: true, status: true, grandTotal: true, amountPaid: true },
    });
    if (!bill) throw new ActionError("Bill not found");
    if (bill.status === VendorBillStatus.PAID) {
      throw new ActionError("Bill is already marked paid");
    }
    if (bill.status === VendorBillStatus.DRAFT || bill.status === VendorBillStatus.PENDING_MATCH) {
      throw new ActionError("Run the 3-way match (or save the bill) before marking it paid");
    }
    const balance = toDecimal(bill.grandTotal).minus(toDecimal(bill.amountPaid));
    // H3: flip the status FIRST via a guarded update (eligible = anything the
    // pre-checks above didn't reject) so a double-click can't create two
    // full-balance payment rows — the loser matches zero rows and aborts.
    const flipped = await tx.vendorBill.updateMany({
      where: {
        id,
        status: {
          notIn: [
            VendorBillStatus.PAID,
            VendorBillStatus.DRAFT,
            VendorBillStatus.PENDING_MATCH,
          ],
        },
      },
      data: {
        amountPaid: bill.grandTotal.toString(),
        status: VendorBillStatus.PAID,
        paidAt: paidAtDate,
      },
    });
    if (flipped.count === 0) {
      throw new ActionError("Already marked paid — refresh the page.");
    }
    if (balance.gt(0)) {
      await tx.vendorBillPayment.create({
        data: {
          vendorBillId: id,
          amount: balance.toFixed(2),
          paidAt: paidAtDate,
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          recordedById: session.user.id,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_BILL_MARKED_PAID",
        entity: "VendorBill",
        entityId: id,
        payloadHash: sha256Json({ balanceCleared: balance.toString() }),
      },
    });
  });

  // Notify Store + Procurement so they can stop chasing the bill.
  // Deferred — best-effort fan-out after the response.
  deferAfterResponse("vendor-bill-paid:notify", async () => {
    const billAfter = await db.vendorBill.findUnique({
      where: { id },
      select: { billNo: true, vendor: { select: { name: true } } },
    });
    if (!billAfter) return;
    await notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
      kind: "VENDOR_BILL_PAID",
      title: `Vendor bill ${billAfter.billNo} paid`,
      body: `Payment to ${billAfter.vendor.name} recorded.`,
      link: `/procurement/vendor-bills/${id}`,
      dedupeKey: `vendor-bill-paid:${id}`,
    });
  });

  revalidatePath("/procurement/vendor-bills");
  revalidatePath(`/procurement/vendor-bills/${id}`);
  revalidatePath("/payments/payables");
  return { ok: true };
}

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listVendorPOs(opts: { status?: VendorPOStatus[]; vendorId?: string } = {}) {
  await requireRole(READ_ROLES);
  return db.vendorPO.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.vendorId ? { vendorId: opts.vendorId } : {}),
    },
    include: {
      vendor: { select: { name: true, code: true } },
      order: { select: { id: true, code: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { issueDate: "desc" },
    take: 200,
  });
}

export async function getVendorPO(id: string) {
  await requireRole(READ_ROLES);
  return db.vendorPO.findUnique({
    where: { id },
    include: {
      vendor: true,
      order: { select: { id: true, code: true } },
      lines: {
        include: {
          ingredient: { select: { name: true, sku: true, unit: true } },
          // Catalogue unit for banquet-linked lines — the draft line editor
          // hints "catalogue tracks <unit>" when the PO unit differs.
          banquetItem: { select: { name: true, unit: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      grns: { select: { id: true, grnNo: true, status: true, receivedAt: true } },
      bills: { select: { id: true, billNo: true, status: true, issueDate: true } },
      approvedBy: { select: { name: true } },
      // Two-step approval breadcrumbs — surfaced in the detail-page header.
      managerApprovedBy: { select: { name: true } },
      adminApprovedBy: { select: { name: true } },
    },
  });
}

export async function listGRNs(opts: { status?: GRNStatus[] } = {}) {
  await requireRole(READ_ROLES);
  return db.gRN.findMany({
    where: opts.status ? { status: { in: opts.status } } : {},
    include: {
      po: { include: { vendor: { select: { name: true } } } },
      _count: { select: { lines: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 200,
  });
}

export async function getGRN(id: string) {
  await requireRole(READ_ROLES);
  return db.gRN.findUnique({
    where: { id },
    include: {
      po: { include: { vendor: true } },
      receivedBy: { select: { name: true } },
      lines: { include: { poLine: { include: { ingredient: { select: { name: true, sku: true, unit: true } } } } }, orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function listVendorBills(opts: { status?: VendorBillStatus[]; vendorId?: string } = {}) {
  await requireRole(READ_ROLES);
  return db.vendorBill.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.vendorId ? { vendorId: opts.vendorId } : {}),
    },
    include: {
      vendor: { select: { id: true, name: true, code: true } },
      po: { select: { poNo: true, order: { select: { code: true } } } },
    },
    orderBy: { issueDate: "desc" },
    take: 200,
  });
}

export async function getVendorBill(id: string) {
  await requireRole(READ_ROLES);
  return db.vendorBill.findUnique({
    where: { id },
    include: {
      vendor: true,
      po: { include: { lines: true, order: { select: { id: true, code: true, customer: { select: { name: true } } } } } },
      matchedBy: { select: { name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { where: { reversedAt: null }, orderBy: { paidAt: "desc" } },
    },
  });
}


// =====================================================================
// VENDOR ADVANCES (paid before the bill exists — client item #12)
// =====================================================================

const ADVANCE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];

/** Record money already paid to a supplier ahead of their bill. */
export async function recordVendorAdvance(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(ADVANCE_ROLES);
    const { VendorAdvanceInput } = await import("@/lib/validators");
    const input = VendorAdvanceInput.parse(raw);
    const amount = toDecimal(input.amount || "0");
    if (amount.lte(0)) throw new ActionError("Enter an advance amount greater than zero.");
    const paidAtDate = new Date(input.paidAt);
    if (Number.isNaN(paidAtDate.getTime())) throw new ActionError("Enter a valid payment date.");

    const row = await db.$transaction(async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId }, select: { name: true } });
      if (!vendor) throw new ActionError("Vendor not found — refresh and pick again.");
      const created = await tx.vendorAdvance.create({
        data: {
          vendorId: input.vendorId,
          poId: input.poId || null,
          amount: amount.toFixed(2),
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          paidAt: paidAtDate,
          recordedById: session.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_ADVANCE_RECORDED",
          entity: "VendorAdvance",
          entityId: created.id,
          payloadHash: sha256Json({ vendorId: input.vendorId, amount: amount.toString(), poId: input.poId ?? null }),
        },
      });
      return created;
    });

    revalidatePath("/procurement/vendor-bills");
    return { ok: true, id: row.id };
  } catch (err) {
    return actionFailure(err);
  }
}

/** Unapplied advances for one vendor — offered on their bills for applying. */
export async function listOpenVendorAdvances(vendorId: string) {
  await requireRole(ADVANCE_ROLES);
  return db.vendorAdvance.findMany({
    where: { vendorId, appliedToBillId: null },
    include: { po: { select: { poNo: true } }, recordedBy: { select: { name: true } } },
    orderBy: { paidAt: "asc" },
  });
}

/**
 * Apply an unapplied advance to a bill of the same vendor. Posts a real
 * VendorBillPayment for the amount (so the payables ledger reconciles) and
 * marks the advance consumed. Refuses when the advance exceeds the bill's
 * open balance — that split needs a human decision, not a silent remainder.
 */
export async function applyVendorAdvanceToBill(
  advanceId: string,
  billId: string,
): Promise<ActionResult> {
  try {
    const session = await requireRole(ADVANCE_ROLES);
    await db.$transaction(async (tx) => {
      // Lock the bill row — amountPaid is read-modify-write below.
      await tx.$executeRaw`SELECT 1 FROM "VendorBill" WHERE "id" = ${billId} FOR UPDATE`;
      const [advance, bill] = await Promise.all([
        tx.vendorAdvance.findUnique({
          where: { id: advanceId },
          select: { vendorId: true, amount: true, appliedToBillId: true, reference: true, method: true },
        }),
        tx.vendorBill.findUnique({
          where: { id: billId },
          select: { vendorId: true, status: true, grandTotal: true, amountPaid: true, billNo: true },
        }),
      ]);
      if (!advance) throw new ActionError("Advance not found — refresh the page.");
      if (advance.appliedToBillId) throw new ActionError("This advance is already applied to a bill.");
      if (!bill) throw new ActionError("Bill not found");
      if (advance.vendorId !== bill.vendorId) {
        throw new ActionError("This advance belongs to a different supplier.");
      }
      if (
        bill.status === VendorBillStatus.DRAFT ||
        bill.status === VendorBillStatus.PENDING_MATCH ||
        bill.status === VendorBillStatus.PAID
      ) {
        throw new ActionError(`Cannot apply an advance to a bill that's ${humanizeStatus(bill.status)}.`);
      }
      const balance = toDecimal(bill.grandTotal).minus(toDecimal(bill.amountPaid));
      const amount = toDecimal(advance.amount);
      if (amount.gt(balance)) {
        throw new ActionError(
          `The advance (${amount.toFixed(2)}) is larger than this bill's balance (${balance.toFixed(2)}) — settle the bill with Mark paid and keep the advance for the next one.`,
        );
      }

      // Consume the advance first with a guarded update — a double-click
      // loses the race and applies nothing twice.
      const consumed = await tx.vendorAdvance.updateMany({
        where: { id: advanceId, appliedToBillId: null },
        data: { appliedToBillId: billId, appliedAt: new Date() },
      });
      if (consumed.count === 0) throw new ActionError("This advance was just applied — refresh.");

      const newPaid = toDecimal(bill.amountPaid).plus(amount);
      const fullyPaid = newPaid.gte(toDecimal(bill.grandTotal));
      await tx.vendorBill.update({
        where: { id: billId },
        data: {
          amountPaid: newPaid.toFixed(2),
          ...(fullyPaid ? { status: VendorBillStatus.PAID, paidAt: new Date() } : {}),
        },
      });
      await tx.vendorBillPayment.create({
        data: {
          vendorBillId: billId,
          amount: amount.toFixed(2),
          paidAt: new Date(),
          method: advance.method,
          reference: advance.reference ?? null,
          notes: "Advance applied",
          recordedById: session.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_ADVANCE_APPLIED",
          entity: "VendorAdvance",
          entityId: advanceId,
          payloadHash: sha256Json({ billId, billNo: bill.billNo, amount: amount.toString() }),
        },
      });
    });

    revalidatePath(`/procurement/vendor-bills/${billId}`);
    revalidatePath("/procurement/vendor-bills");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}
