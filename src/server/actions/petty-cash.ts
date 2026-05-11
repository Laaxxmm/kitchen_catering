"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { PettyCashVoucherStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
import { AuthorizationError, requireRole } from "@/server/rbac";
import {
  PettyCashFloatInput,
  PettyCashTopUpInput,
  PettyCashVoucherInput,
} from "@/lib/validators";
import { nextPettyCashVoucherNo } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";

const ADMIN_OR_MANAGER = [Role.ADMIN, Role.MANAGER];
const ANY_WRITE = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS];
const TOPUP_APPROVAL_THRESHOLD = new Decimal(10000); // ₹10k — requires manager+ approval

// ─── Float CRUD ──────────────────────────────────────────────────────────

export async function createPettyCashFloat(raw: unknown) {
  const session = await requireRole(ADMIN_OR_MANAGER);
  const input = PettyCashFloatInput.parse(raw);
  const f = await db.$transaction(async (tx) => {
    const created = await tx.pettyCashFloat.create({
      data: {
        custodianId: input.custodianId,
        name: input.name,
        openingBalance: input.openingBalance,
        currentBalance: input.openingBalance,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PETTY_CASH_FLOAT_CREATED",
        entity: "PettyCashFloat",
        entityId: created.id,
        payloadHash: sha256Json({ name: input.name, opening: input.openingBalance }),
      },
    });
    return created;
  });
  revalidatePath("/petty-cash");
  return { id: f.id };
}

export async function listPettyCashFloats() {
  await requireRole(ANY_WRITE);
  return db.pettyCashFloat.findMany({
    where: { active: true },
    include: {
      custodian: { select: { name: true } },
      _count: { select: { vouchers: true, topUps: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPettyCashFloat(id: string) {
  await requireRole(ANY_WRITE);
  return db.pettyCashFloat.findUnique({
    where: { id },
    include: {
      custodian: { select: { name: true, email: true } },
      vouchers: {
        orderBy: { paidAt: "desc" },
        take: 100,
        include: { createdBy: { select: { name: true } }, approvedBy: { select: { name: true } } },
      },
      topUps: { orderBy: { createdAt: "desc" }, take: 100, include: { approvedBy: { select: { name: true } } } },
    },
  });
}

// ─── Voucher ─────────────────────────────────────────────────────────────

export async function createPettyCashVoucher(raw: unknown) {
  const session = await requireRole(ANY_WRITE);
  const input = PettyCashVoucherInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const float = await tx.pettyCashFloat.findUnique({
      where: { id: input.floatId },
      select: { id: true, custodianId: true, currentBalance: true, active: true },
    });
    if (!float) throw new Error("Float not found");
    if (!float.active) throw new Error("Float is inactive");
    // The custodian is the primary author. ADMIN/MANAGER can also draft on
    // behalf of the custodian.
    if (
      float.custodianId !== session.user.id &&
      session.user.role !== Role.ADMIN &&
      session.user.role !== Role.MANAGER
    ) {
      throw new AuthorizationError("Only the float custodian (or admin/manager) can create vouchers");
    }
    const amount = toDecimal(input.amount);
    if (amount.lte(0)) throw new Error("Voucher amount must be positive");
    const remaining = toDecimal(float.currentBalance);
    if (amount.gt(remaining)) {
      throw new Error(`Insufficient float balance. ₹${remaining.toString()} available, ₹${amount.toString()} requested`);
    }

    const voucherNo = await nextPettyCashVoucherNo(tx);
    const voucher = await tx.pettyCashVoucher.create({
      data: {
        voucherNo,
        floatId: float.id,
        amount: input.amount,
        category: input.category,
        paidTo: input.paidTo,
        reason: input.reason,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        status: PettyCashVoucherStatus.POSTED,
        createdById: session.user.id,
      },
    });

    await tx.pettyCashFloat.update({
      where: { id: float.id },
      data: { currentBalance: remaining.minus(amount).toDecimalPlaces(2).toString() },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PETTY_CASH_VOUCHER_POSTED",
        entity: "PettyCashVoucher",
        entityId: voucher.id,
        payloadHash: sha256Json({ amount: input.amount, category: input.category, paidTo: input.paidTo }),
      },
    });
    return voucher;
  });

  revalidatePath("/petty-cash");
  revalidatePath(`/petty-cash/floats/${input.floatId}`);
  return { id: result.id, voucherNo: result.voucherNo };
}

export async function reversePettyCashVoucher(id: string, reason: string) {
  const session = await requireRole(ADMIN_OR_MANAGER);
  if (!reason.trim()) throw new Error("Reason required");
  await db.$transaction(async (tx) => {
    const voucher = await tx.pettyCashVoucher.findUnique({
      where: { id },
      select: { id: true, floatId: true, amount: true, status: true, reversedAt: true },
    });
    if (!voucher) throw new Error("Voucher not found");
    if (voucher.reversedAt || voucher.status === PettyCashVoucherStatus.REVERSED) {
      throw new Error("Voucher already reversed");
    }
    await tx.pettyCashVoucher.update({
      where: { id },
      data: {
        status: PettyCashVoucherStatus.REVERSED,
        reversedAt: new Date(),
        reversedReason: reason,
      },
    });
    const float = await tx.pettyCashFloat.findUnique({
      where: { id: voucher.floatId },
      select: { currentBalance: true },
    });
    if (!float) throw new Error("Parent float missing");
    await tx.pettyCashFloat.update({
      where: { id: voucher.floatId },
      data: {
        currentBalance: toDecimal(float.currentBalance).plus(toDecimal(voucher.amount)).toDecimalPlaces(2).toString(),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PETTY_CASH_VOUCHER_REVERSED",
        entity: "PettyCashVoucher",
        entityId: id,
        payloadHash: sha256Json({ reason }),
      },
    });
  });
  revalidatePath("/petty-cash");
}

// ─── Top-up ──────────────────────────────────────────────────────────────

export async function topUpPettyCash(raw: unknown) {
  const session = await requireRole(ADMIN_OR_MANAGER);
  const input = PettyCashTopUpInput.parse(raw);
  const amount = toDecimal(input.amount);
  if (amount.lte(0)) throw new Error("Top-up amount must be positive");

  // Anything over the threshold needs MANAGER+ approval; we already gate
  // entry to this action behind MANAGER/ADMIN, so the threshold is more
  // about an audit-trail breadcrumb than a hard guard.
  const needsApproval = amount.gt(TOPUP_APPROVAL_THRESHOLD);

  await db.$transaction(async (tx) => {
    const float = await tx.pettyCashFloat.findUnique({
      where: { id: input.floatId },
      select: { id: true, currentBalance: true, active: true },
    });
    if (!float || !float.active) throw new Error("Float not found or inactive");
    await tx.pettyCashTopUp.create({
      data: {
        floatId: float.id,
        amount: input.amount,
        source: input.source,
        reference: input.reference ?? null,
        approvedByUserId: session.user.id,
        approvedAt: new Date(),
      },
    });
    await tx.pettyCashFloat.update({
      where: { id: float.id },
      data: {
        currentBalance: toDecimal(float.currentBalance).plus(amount).toDecimalPlaces(2).toString(),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: needsApproval ? "PETTY_CASH_TOP_UP_OVER_THRESHOLD" : "PETTY_CASH_TOP_UP",
        entity: "PettyCashFloat",
        entityId: float.id,
        payloadHash: sha256Json({ amount: input.amount, source: input.source }),
      },
    });
  });

  revalidatePath("/petty-cash");
  revalidatePath(`/petty-cash/floats/${input.floatId}`);
}
