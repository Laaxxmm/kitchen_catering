"use server";

/**
 * The supplier's bill. Record it (prefilled from the PO), correct it, run the 3-way
 * match against PO and GRN, approve it — a failed match needs a written reason — and
 * mark it paid.
 */

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { PaymentMethod, Role, VendorBillStatus } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { ActionError, actionFailure, type ActionResult, type ActionResultWith } from "@/server/action-result";
import { deferAfterResponse } from "@/server/defer";
import { VendorBillCreateInput, VendorBillUpdateInput, type VendorBillLineInputT } from "@/lib/validators";
import { computeLine, summarise } from "@/lib/gst";
import { humanizeStatus } from "@/lib/order-status";
import { approveRefusal, editRefusal, payRefusal, PAYABLE_STATUSES } from "@/lib/vendor-bill-gates";
import { nextVendorBillNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { notifyRoles } from "@/server/notification-core";
import { APPROVE_ROLES, RECEIVED_GRN_STATUSES } from "./_shared";

// Store keeper records the vendor's invoice at goods-in (they hold the
// physical bill) and can 3-way match it; approve + pay stay finance-only
// (APPROVE_ROLES / the payment gate).
const BILL_WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.STORE_KEEPER];

// Supplier-bill approval additionally includes accounts (client item #12) —
// they run the payables desk. PO approval above stays management-only.
const BILL_APPROVE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];

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
    // "Obviously invoice cannot be generated before accepting GRN" — a hard
    // block. Against a PO, something must actually have been received first.
    if (input.poId) {
      const po = await tx.vendorPO.findUnique({
        where: { id: input.poId },
        select: { poNo: true },
      });
      if (!po) throw new ActionError("That purchase order no longer exists — refresh the page.");
      const received = await tx.gRN.count({
        where: { poId: input.poId, status: { in: RECEIVED_GRN_STATUSES } },
      });
      if (received === 0) {
        throw new ActionError(
          `Nothing has been received against ${po.poNo} yet — accept the GRN first. A supplier bill can't be raised before the goods are in.`,
        );
      }
    }

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

  // Until now recording a bill told nobody: it landed in DRAFT and sat there
  // unless someone happened to browse to it. The desk that has to match,
  // approve and pay it hears about it the moment it exists.
  deferAfterResponse("vendor-bill-recorded:notify", async () => {
    const after = await db.vendorBill.findUnique({
      where: { id: result.id },
      select: {
        billNo: true,
        vendor: { select: { name: true } },
        po: { select: { poNo: true } },
      },
    });
    if (!after) return;
    await notifyRoles(BILL_APPROVE_ROLES, {
      kind: "GENERIC",
      title: `Supplier bill ${after.billNo} recorded — ${after.vendor.name}`,
      body: after.po
        ? `Against ${after.po.poNo}. Run the 3-way match, then approve it. Nothing is paid until you do.`
        : "No linked PO. Approve it before it can be paid.",
      link: `/procurement/vendor-bills/${result.id}`,
      dedupeKey: `bill-recorded:${result.id}`,
    });
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
    // Editing a mismatched bill IS the "pay only for what we ordered and
    // got" correction — it needs a reason on the record, not just in someone's
    // memory. (AuditLog keeps a payload hash nobody can read back.)
    const reason = input.reason?.trim() ?? null;
    const reasonRefusal = editRefusal(bill.billNo, bill.status, reason);
    if (reasonRefusal) throw new ActionError(reasonRefusal);
    const wasDiscrepancy = bill.status === VendorBillStatus.DISCREPANCY;

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
        // Keep the correction's reason on the bill; a plain DRAFT edit leaves
        // whatever was there alone.
        ...(wasDiscrepancy ? { discrepancyEditReason: reason } : {}),
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
  const result = await db.$transaction(async (tx) => {
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
    return { ok: true as const, matched, discrepancies, billNo: bill.billNo, poNo: bill.po.poNo };
  });

  // The match verdict is the moment a bill starts waiting on a human. A
  // failure names the PO and says so plainly — a DISCREPANCY that nobody is
  // told about is the bill that sits unpayable for a fortnight.
  //
  // Deliberately no dedupeKey: an edited bill can be re-matched and fail
  // again, and that second failure has to be heard, not swallowed as a
  // duplicate.
  const { matched, discrepancies, billNo, poNo } = result;
  deferAfterResponse("vendor-bill-match:notify", () =>
    notifyRoles(BILL_APPROVE_ROLES, {
      kind: "GENERIC",
      title: matched
        ? `Bill ${billNo} matched ${poNo} — needs your approval`
        : `Bill ${billNo} FAILED the 3-way match against ${poNo}`,
      body: matched
        ? "It agrees with the PO and the delivery. Approve it and it becomes payable."
        : `${discrepancies.length} discrepancy(ies) — the supplier is billing something other than what was ordered and received. Correct the amounts or approve it with a written reason. It cannot be paid as it stands.`,
      link: `/procurement/vendor-bills/${id}`,
    }),
  );

  return { ok: true as const, matched, discrepancies };
}

/**
 * Accounts sign off the bill — the step that makes it payable at all.
 *
 * The vendor's own invoice is prompted for but not required: vendors hand it
 * over late or not at all, and requiring it left every bill unapprovable and
 * therefore unpayable. Approving a bill that failed the 3-way match still
 * takes a written reason — someone is consciously agreeing to pay other than
 * what was ordered and received, and that has to be attributable.
 */
export async function approveVendorBill(id: string, reason?: string | null): Promise<ActionResult> {
  try {
    const session = await requireRole(BILL_APPROVE_ROLES);
    await db.$transaction(async (tx) => {
      const bill = await tx.vendorBill.findUnique({
        where: { id },
        select: { status: true, billNo: true },
      });
      if (!bill) throw new ActionError("Bill not found");
      const refusal = approveRefusal({
        billNo: bill.billNo,
        status: bill.status,
        reason: reason ?? null,
      });
      if (refusal) throw new ActionError(refusal);
      // Status guard: a double-approve loses the race with a clear message.
      const updated = await tx.vendorBill.updateMany({
        where: { id, status: { in: [VendorBillStatus.MATCHED, VendorBillStatus.DISCREPANCY] } },
        data: {
          status: VendorBillStatus.APPROVED,
          approvedByUserId: session.user.id,
          approvedAt: new Date(),
          // Only a mismatch carries a justification; a clean match needs none.
          ...(bill.status === VendorBillStatus.DISCREPANCY
            ? { approvalNote: (reason ?? "").trim() }
            : {}),
        },
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
      select: { id: true, billNo: true, status: true, grandTotal: true, amountPaid: true },
    });
    if (!bill) throw new ActionError("Bill not found");
    // Nothing is payable before accounts approve it — a MATCHED or
    // DISCREPANCY bill included. The button is hidden for those, but a stale
    // tab (or a replayed request) still reaches this action.
    const refusal = payRefusal(bill.billNo, bill.status);
    if (refusal) throw new ActionError(refusal);
    const balance = toDecimal(bill.grandTotal).minus(toDecimal(bill.amountPaid));
    // H3: flip the status FIRST via a guarded update (eligible = the payable
    // statuses only) so a double-click can't create two full-balance payment
    // rows — the loser matches zero rows and aborts.
    const flipped = await tx.vendorBill.updateMany({
      where: { id, status: { in: PAYABLE_STATUSES } },
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
