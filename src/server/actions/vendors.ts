"use server";

import { revalidatePath } from "next/cache";
import { Role, VendorCategory, VendorPaymentTerms } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { VendorInput, type VendorInputT } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import { nextVendorCode } from "@/lib/sequences";
import {
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS];
const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS, Role.KITCHEN_HEAD];

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

  const vendor = await db.$transaction(async (tx) => {
    const code = await nextVendorCode(tx);
    const row = await tx.vendor.create({
      data: { code, ...dataFromInput(input) },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_CREATED",
        entity: "Vendor",
        entityId: row.id,
        payloadHash: sha256Json({ code, name: input.name }),
      },
    });
    return row;
  });

  revalidatePath("/procurement/vendors");
  return { ok: true, id: vendor.id, code: vendor.code };
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

  let running = 0;
  const out: VendorTimelineEntry[] = [];
  let totalBilled = 0;
  let totalPaid = 0;
  for (const e of events) {
    if (e.type === "BILL") {
      running += Number(e.bill.grandTotal);
      totalBilled += Number(e.bill.grandTotal);
      out.push({
        kind: "BILL",
        id: e.bill.id,
        occurredAt: e.at,
        billNo: e.bill.billNo,
        vendorBillNo: e.bill.vendorBillNo,
        status: e.bill.status,
        grandTotal: e.bill.grandTotal.toString(),
        amountPaid: e.bill.amountPaid.toString(),
        runningOutstanding: running.toFixed(2),
      });
    } else {
      running -= Number(e.payment.amount);
      totalPaid += Number(e.payment.amount);
      out.push({
        kind: "PAYMENT",
        id: e.payment.id,
        occurredAt: e.at,
        billNo: e.bill.billNo,
        method: e.payment.method,
        reference: e.payment.reference,
        amount: e.payment.amount.toString(),
        runningOutstanding: running.toFixed(2),
      });
    }
  }
  return {
    timeline: out.reverse(),
    totals: {
      billed: totalBilled.toFixed(2),
      paid: totalPaid.toFixed(2),
      outstanding: running.toFixed(2),
    },
  };
}
