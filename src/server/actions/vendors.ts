"use server";

import { revalidatePath } from "next/cache";
import { Role, VendorApprovalStatus, VendorCategory, VendorPaymentTerms } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { VendorInput, type VendorInputT } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import { nextVendorCode } from "@/lib/sequences";
import { toDecimal } from "@/lib/money";
import { notifyRoles } from "@/server/notification-core";
import { deferAfterResponse } from "@/server/defer";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS];
// DELIVERY / FNB_SERVICE read vendors for the banquet requisition fulfil
// page's vendor picker ("Raise PO for shortfall") — they run the banquet
// store counter alongside the store keeper. Read-only; writes stay above.
const READ_ROLES = [
  Role.ADMIN,
  Role.MANAGER,
  Role.STORE_KEEPER,
  Role.ACCOUNTS,
  Role.KITCHEN_HEAD,
  Role.DELIVERY,
  Role.FNB_SERVICE,
];

function dataFromInput(input: VendorInputT) {
  return {
    name: input.name,
    gstin: input.gstin ?? null,
    pan: input.pan ?? null,
    stateCode: input.stateCode,
    category: (input.category as VendorCategory | undefined) ?? VendorCategory.OTHER,
    msme: input.msme ?? false,
    contactName: input.contactName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    paymentTerms: (input.paymentTerms as VendorPaymentTerms | undefined) ?? VendorPaymentTerms.NET_30,
    notes: input.notes ?? null,
    defaultTdsRatePct: input.defaultTdsRatePct ?? null,
    defaultTdsSection: input.defaultTdsSection ?? null,
    ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
  };
}

export async function createVendor(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; code: string }>> {
  try {
    return await createVendorInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createVendorInner(raw: unknown): Promise<{ ok: true; id: string; code: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = VendorInput.parse(raw);

  // Re-adding a supplier that already exists used to mint a duplicate — and
  // since store-created vendors start PENDING_APPROVAL, that duplicate then
  // blocked POs even though the original was already approved ("Smart Bazar "
  // vs "Smart Bazar"). Reuse the existing record instead; the caller selects
  // it exactly as if it had just been created.
  const existing = await db.vendor.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" }, active: true },
    select: { id: true, code: true },
  });
  if (existing) return { ok: true, id: existing.id, code: existing.code };

  // Store-keeper-added vendors need a management sign-off before POs can be
  // raised on them; admin/manager/accounts creations stay auto-approved.
  const needsApproval = session.user.role === Role.STORE_KEEPER;

  const vendor = await db.$transaction(async (tx) => {
    const code = await nextVendorCode(tx);
    const row = await tx.vendor.create({
      data: {
        code,
        ...dataFromInput(input),
        ...(needsApproval ? { approvalStatus: VendorApprovalStatus.PENDING_APPROVAL } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_CREATED",
        entity: "Vendor",
        entityId: row.id,
        payloadHash: sha256Json({ code, name: input.name, needsApproval }),
      },
    });
    return row;
  });

  if (needsApproval) {
    deferAfterResponse("vendor-create:notify-approvers", () =>
      notifyRoles([Role.ADMIN, Role.MANAGER], {
        kind: "GENERIC",
        title: `New vendor ${vendor.name} awaits approval`,
        body: `The store added vendor ${vendor.name} (${vendor.code}). Approve them before purchase orders can be raised.`,
        link: `/procurement/vendors/${vendor.id}`,
        dedupeKey: `vendor-approval:${vendor.id}`,
      }),
    );
  }

  revalidatePath("/procurement/vendors");
  return { ok: true, id: vendor.id, code: vendor.code };
}

/**
 * Management sign-off on a store-keeper-added vendor. Guarded
 * PENDING_APPROVAL → APPROVED; anything else refuses. Vendor has no
 * creator column, so the "approved" notice fans out to the store-keeper
 * role instead of a specific user.
 */
export async function approveVendor(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole([Role.ADMIN, Role.MANAGER]);
    const vendor = await db.$transaction(async (tx) => {
      const row = await tx.vendor.findUnique({ where: { id } });
      if (!row) throw new ActionError("Vendor not found");
      if (row.approvalStatus !== VendorApprovalStatus.PENDING_APPROVAL) {
        throw new ActionError("This vendor is already approved.");
      }
      await tx.vendor.update({
        where: { id },
        data: { approvalStatus: VendorApprovalStatus.APPROVED },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_APPROVED",
          entity: "Vendor",
          entityId: id,
        },
      });
      return row;
    });

    deferAfterResponse("vendor-approve:notify-store", () =>
      notifyRoles([Role.STORE_KEEPER], {
        kind: "GENERIC",
        title: `Vendor ${vendor.name} approved — POs can now be raised`,
        link: `/procurement/vendors/${id}`,
        dedupeKey: `vendor-approved:${id}`,
      }),
    );

    revalidatePath("/procurement/vendors");
    revalidatePath(`/procurement/vendors/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function updateVendor(id: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    const input = VendorInput.parse(raw);
    await db.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id }, data: dataFromInput(input) });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_UPDATED",
          entity: "Vendor",
          entityId: id,
        },
      });
    });
    revalidatePath("/procurement/vendors");
    revalidatePath(`/procurement/vendors/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function deactivateVendor(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole([Role.ADMIN, Role.MANAGER]);
    await db.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id }, data: { active: false } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "VENDOR_DEACTIVATED",
          entity: "Vendor",
          entityId: id,
        },
      });
    });
    revalidatePath("/procurement/vendors");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function listVendors(opts: { query?: string; active?: boolean; category?: VendorCategory } = {}) {
  await requireRole(READ_ROLES);
  return db.vendor.findMany({
    where: {
      ...(opts.active !== undefined ? { active: opts.active } : {}),
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.query
        ? {
            OR: [
              { name: { contains: opts.query, mode: "insensitive" } },
              { code: { contains: opts.query, mode: "insensitive" } },
              { gstin: { contains: opts.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 300,
  });
}

export async function getVendor(id: string) {
  await requireRole(READ_ROLES);
  return db.vendor.findUnique({ where: { id } });
}

/**
 * Full per-vendor activity timeline: every bill issued against this
 * vendor, every payment recorded, and a running outstanding total.
 *
 * Used by the vendor detail page's "History" panel. The result is
 * sorted reverse-chronologically so the latest event shows at the
 * top; the `runningOutstanding` field shows what the balance was
 * AFTER each event landed.
 */
export type VendorTimelineEntry =
  | {
      kind: "BILL";
      id: string;
      occurredAt: Date;
      billNo: string;
      vendorBillNo: string | null;
      status: string;
      grandTotal: string;
      amountPaid: string;
      runningOutstanding: string;
    }
  | {
      kind: "PAYMENT";
      id: string;
      occurredAt: Date;
      billNo: string;
      method: string;
      reference: string | null;
      amount: string;
      runningOutstanding: string;
    };

export async function getVendorHistory(vendorId: string) {
  await requireRole(READ_ROLES);
  const bills = await db.vendorBill.findMany({
    where: { vendorId },
    include: {
      payments: {
        where: { reversedAt: null },
        orderBy: { paidAt: "asc" },
      },
    },
    orderBy: { issueDate: "asc" },
  });

  // Build chronological timeline (oldest -> newest), then reverse for
  // display. Running balance accumulates across all bills + payments.
  type Raw =
    | { type: "BILL"; at: Date; bill: (typeof bills)[number] }
    | { type: "PAYMENT"; at: Date; bill: (typeof bills)[number]; payment: (typeof bills)[number]["payments"][number] };
  const events: Raw[] = [];
  for (const b of bills) {
    events.push({ type: "BILL", at: b.issueDate, bill: b });
    for (const p of b.payments) {
      events.push({ type: "PAYMENT", at: p.paidAt, bill: b, payment: p });
    }
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Decimal accumulation throughout — this is money (L3: the previous
  // Number() float version drifted on paise).
  let running = toDecimal(0);
  let totalBilled = toDecimal(0);
  let totalPaid = toDecimal(0);
  const out: VendorTimelineEntry[] = [];
  for (const e of events) {
    if (e.type === "BILL") {
      const amount = toDecimal(e.bill.grandTotal);
      running = running.plus(amount);
      totalBilled = totalBilled.plus(amount);
      out.push({
        kind: "BILL",
        id: e.bill.id,
        occurredAt: e.at,
        billNo: e.bill.billNo,
        vendorBillNo: e.bill.vendorBillNo,
        status: e.bill.status,
        grandTotal: e.bill.grandTotal.toString(),
        amountPaid: e.bill.amountPaid.toString(),
        runningOutstanding: running.toDecimalPlaces(2).toString(),
      });
    } else {
      const amount = toDecimal(e.payment.amount);
      running = running.minus(amount);
      totalPaid = totalPaid.plus(amount);
      out.push({
        kind: "PAYMENT",
        id: e.payment.id,
        occurredAt: e.at,
        billNo: e.bill.billNo,
        method: e.payment.method,
        reference: e.payment.reference,
        amount: e.payment.amount.toString(),
        runningOutstanding: running.toDecimalPlaces(2).toString(),
      });
    }
  }
  return {
    timeline: out.reverse(),
    totals: {
      billed: totalBilled.toDecimalPlaces(2).toString(),
      paid: totalPaid.toDecimalPlaces(2).toString(),
      outstanding: running.toDecimalPlaces(2).toString(),
    },
  };
}
