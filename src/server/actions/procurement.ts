"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import {
  BanquetRequisitionLineStatus,
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
import { summarise } from "@/lib/gst";
import { indefineStateCode } from "@/lib/org";
import { nextGRNNumber, nextVendorBillNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { newMovingAverage } from "@/lib/inventory-cost";
import { toDecimal } from "@/lib/money";
import { getSettingOr } from "@/lib/settings";
import { createNotification, notifyRoles } from "@/server/actions/notifications";
import { createVendorPOTx } from "@/server/procurement-core";
import { lockBanquetItemRows, recomputeBanquetReqStatus } from "@/server/banquet-core";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];
// Supplier-bill handling (create + 3-way match) is a finance-desk job, not
// a store job. Per the client: "record supplier bill is not required for
// store or chef — only admin, manager and finance." Store keepers receive
// goods (GRN) and stock updates automatically; the bill never touches them.
const BILL_WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];
const APPROVE_ROLES = [Role.ADMIN, Role.MANAGER];
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
      throw new ActionError(`Only draft POs can be edited — this one is ${po.status}.`);
    }
    const poLineIds = new Set(po.lines.map((l) => l.id));
    for (const l of input.lines) {
      if (!poLineIds.has(l.id)) {
        throw new ActionError("One of the edited lines doesn't belong to this PO — refresh the page.");
      }
    }

    // Per-line amounts: identical math to createVendorPOTx.
    for (const l of input.lines) {
      const q = toDecimal(l.quantity);
      const u = toDecimal(l.unitPrice);
      const g = toDecimal(l.gstRatePct).div(100);
      const sub = q.times(u);
      const tax = sub.times(g);
      await tx.vendorPOLine.update({
        where: { id: l.id },
        data: {
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          gstRatePct: l.gstRatePct,
          lineSubtotal: sub.toDecimalPlaces(2).toString(),
          lineTax: tax.toDecimalPlaces(2).toString(),
          lineTotal: sub.plus(tax).toDecimalPlaces(2).toString(),
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
        vendor: { select: { name: true } },
      },
    });
    if (!po) throw new ActionError("PO not found");
    if (po.status !== VendorPOStatus.DRAFT) {
      throw new ActionError("Only DRAFT POs can be submitted");
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
    const session = await requireRole(APPROVE_ROLES);
    if (!reason.trim()) throw new ActionError("Reason required");
    await db.$transaction(async (tx) => {
      await tx.vendorPO.update({
        where: { id },
        data: { status: VendorPOStatus.CANCELLED, closedAt: new Date(), notes: reason },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_PO_CANCELLED",
          entity: "VendorPO",
          entityId: id,
          payloadHash: sha256Json({ reason }),
        },
      });
    });
    revalidatePath(`/procurement/purchase-orders/${id}`);
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

/** lower(trim(unit)) — "Pkt " and "pkt" are the same unit, "pkt" vs "piece" is not. */
function unitsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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

      const orderedRemaining = toDecimal(poLine.quantity).minus(toDecimal(poLine.receivedQty));
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

      // Post inventory only if accepted > 0 AND the PO line links to an Ingredient.
      if (accepted.gt(0) && poLine.ingredientId && poLine.ingredient &&
          !unitsMatch(poLine.unit, poLine.ingredient.unit)) {
        // PO bought in a different unit than the catalogue tracks — the
        // accepted qty/price would corrupt onHandQty and moving-average
        // cost. Record the receipt on the GRN but leave stock alone.
        warnings.push(
          `GRN ${grnNo}: ${poLine.ingredient.name} received in ${poLine.unit.trim()} but the catalogue tracks ${poLine.ingredient.unit.trim()} — stock NOT auto-updated; correct it via stock count / receipt and then issue.`,
        );
      } else if (accepted.gt(0) && poLine.ingredientId && poLine.ingredient) {
        const ing = poLine.ingredient;
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
      }

      // Banquet-store goods (PO raised off an F&B requisition shortfall):
      // post a real BanquetReceipt, bump the item's stock, and flip the
      // linked requisition lines back to PENDING so the store issues them.
      if (accepted.gt(0) && poLine.banquetItemId && poLine.banquetItem &&
          !unitsMatch(poLine.unit, poLine.banquetItem.unit)) {
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

        // Requisition lines waiting on this exact PO line: goods are in, so
        // they're issuable again. Parent statuses are recomputed per req.
        const linked = await tx.banquetRequisitionLine.findMany({
          where: {
            vendorPOLineId: poLine.id,
            status: BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
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

      // Update PO line receivedQty
      await tx.vendorPOLine.update({
        where: { id: poLine.id },
        data: { receivedQty: { increment: accepted.toNumber() } },
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
    const q = toDecimal(l.quantity);
    const u = toDecimal(l.unitPrice);
    const g = toDecimal(l.gstRatePct ?? "0").div(100);
    const sub = q.times(u);
    const tax = sub.times(g);
    subtotal = subtotal.plus(sub);
    taxTotal = taxTotal.plus(tax);
    return {
      sortOrder: idx,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      gstRatePct: l.gstRatePct ?? "0",
      lineSubtotal: sub.toDecimalPlaces(2).toString(),
      lineTax: tax.toDecimalPlaces(2).toString(),
      lineTotal: sub.plus(tax).toDecimalPlaces(2).toString(),
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
 * Edit a supplier bill that hasn't entered the match/approval pipeline —
 * DRAFT or PENDING_MATCH only. Matched / discrepancy / approved / paid
 * bills are financial records and stay immutable. Editable fields:
 * vendorBillNo, issue/due dates, notes and the lines (full replace, totals
 * recomputed via the same computation createVendorBill uses). Any previous
 * match result is stale after an edit, so the match fields are reset to
 * the same clean state createVendorBill initialises them with.
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
    if (bill.status !== VendorBillStatus.DRAFT && bill.status !== VendorBillStatus.PENDING_MATCH) {
      throw new ActionError(
        `${bill.billNo} is ${bill.status} — matched/approved/paid bills are financial records and can't be edited. Record a fresh bill or contact an admin.`,
      );
    }

    const { linesData, subtotal, taxTotal } = computeVendorBillLines(input.lines);

    // Status guard: someone running the 3-way match (or a payment) while
    // this edit is in flight loses the race with a clear message.
    const updated = await tx.vendorBill.updateMany({
      where: { id, status: { in: [VendorBillStatus.DRAFT, VendorBillStatus.PENDING_MATCH] } },
      data: {
        vendorBillNo: input.vendorBillNo ?? null,
        ...(input.issueDate ? { issueDate: new Date(input.issueDate) } : {}),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        notes: input.notes ?? null,
        subtotal: subtotal.toDecimalPlaces(2).toString(),
        taxTotal: taxTotal.toDecimalPlaces(2).toString(),
        grandTotal: subtotal.plus(taxTotal).toDecimalPlaces(2).toString(),
        // The lines changed, so any earlier match result is stale — reset
        // to the same clean state a freshly created bill has.
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
    await tx.vendorBill.update({
      where: { id },
      data: {
        status: matched ? VendorBillStatus.MATCHED : VendorBillStatus.DISCREPANCY,
        matchedByUserId: matched ? session.user.id : null,
        matchedAt: matched ? new Date() : null,
        discrepancyNote: matched ? null : JSON.stringify(discrepancies),
      },
    });
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
    const session = await requireRole(APPROVE_ROLES);
    await db.$transaction(async (tx) => {
      const bill = await tx.vendorBill.findUnique({ where: { id }, select: { status: true } });
      if (!bill) throw new ActionError("Bill not found");
      if (bill.status !== VendorBillStatus.MATCHED && bill.status !== VendorBillStatus.DISCREPANCY) {
        throw new ActionError(`Cannot approve a bill in status ${bill.status}`);
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
    await tx.vendorBill.update({
      where: { id },
      data: {
        amountPaid: bill.grandTotal.toString(),
        status: VendorBillStatus.PAID,
        paidAt: paidAtDate,
      },
    });
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
      order: { select: { code: true } },
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
      po: { select: { poNo: true } },
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
      po: { include: { lines: true } },
      matchedBy: { select: { name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { where: { reversedAt: null }, orderBy: { paidAt: "desc" } },
    },
  });
}
