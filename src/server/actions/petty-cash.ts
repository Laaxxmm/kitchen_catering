"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { PettyCashVoucherStatus, Role, type Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { AuthorizationError, requireRole } from "@/server/rbac";
import {
  PettyCashFloatInput,
  PettyCashTopUpInput,
  PettyCashVoucherInput,
  PettyCashVoucherUpdateInput,
} from "@/lib/validators";
import { nextPettyCashVoucherNo } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal, formatINR } from "@/lib/money";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

// Petty cash is a finance-desk responsibility — the accounts team runs it
// end to end (create floats, top up, reverse, record vouchers) alongside
// admin/manager. Reads are gated the same as the /petty-cash routes in
// middleware.ts (ADMIN/MANAGER/ACCOUNTS) — field roles could previously
// reach balances/vouchers by direct action invocation (AUDIT_REPORT M3).
const PETTY_MANAGE = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];
// ₹10k — above this a top-up is audit-logged under its own action name. It
// is not an approval gate; see topUpPettyCashInner.
const TOPUP_APPROVAL_THRESHOLD = new Decimal(10000);

/**
 * Row-lock a float for the rest of the transaction. Every balance movement
 * (voucher / top-up / reversal) reads currentBalance, computes, then writes
 * back — without the lock two concurrent movements read the same snapshot
 * and one update is silently lost (the balance can even go negative past
 * the "insufficient balance" check). FOR UPDATE serialises them: the second
 * caller waits, then reads the committed value.
 */
async function lockFloatRow(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "PettyCashFloat" WHERE "id" = ${id} FOR UPDATE`;
}

// ─── Float CRUD ──────────────────────────────────────────────────────────

export async function createPettyCashFloat(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await createPettyCashFloatInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createPettyCashFloatInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(PETTY_MANAGE);
  const input = PettyCashFloatInput.parse(raw);
  // decimalString lets "" through as "not provided", and an empty opening
  // balance then reached Prisma as `openingBalance: ""` — a raw
  // PrismaClientValidationError and a "Something went wrong" toast. Blank is
  // not zero: say so. (Same guard shape as the vendor-bill line amounts.)
  if (!input.openingBalance.trim()) {
    throw new ActionError("Enter the opening balance the tin starts with (0 is fine).");
  }
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
  return { ok: true, id: f.id };
}

export async function listPettyCashFloats() {
  await requireRole(PETTY_MANAGE);
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
  await requireRole(PETTY_MANAGE);
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

/**
 * Single voucher with the fields the printable PDF needs (float name,
 * recorded-by). Read-gated like the rest of petty cash (PETTY_MANAGE = the
 * roles that can view a float). Returns null when not found.
 */
export async function getPettyCashVoucherForPdf(id: string) {
  await requireRole(PETTY_MANAGE);
  return db.pettyCashVoucher.findUnique({
    where: { id },
    include: {
      float: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
}

// ─── Voucher ─────────────────────────────────────────────────────────────

export async function createPettyCashVoucher(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; voucherNo: string; warning?: string }>> {
  try {
    return await createPettyCashVoucherInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createPettyCashVoucherInner(
  raw: unknown,
): Promise<{ ok: true; id: string; voucherNo: string; warning?: string }> {
  const session = await requireRole(PETTY_MANAGE);
  const input = PettyCashVoucherInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    await lockFloatRow(tx, input.floatId);
    const float = await tx.pettyCashFloat.findUnique({
      where: { id: input.floatId },
      select: { id: true, custodianId: true, currentBalance: true, active: true },
    });
    if (!float) throw new ActionError("Float not found");
    if (!float.active) throw new ActionError("Float is inactive");
    // The custodian is the primary author. ADMIN/MANAGER can also draft on
    // behalf of the custodian.
    if (
      float.custodianId !== session.user.id &&
      session.user.role !== Role.ADMIN &&
      session.user.role !== Role.MANAGER &&
      session.user.role !== Role.ACCOUNTS
    ) {
      throw new AuthorizationError("Only the float custodian (or admin/manager/accounts) can create vouchers");
    }
    const amount = toDecimal(input.amount);
    if (amount.lte(0)) throw new ActionError("Voucher amount must be positive");
    const remaining = toDecimal(float.currentBalance);
    // Floats are allowed to go negative (IOU situations — client confirmed,
    // #30). The balance still moves atomically under lockFloatRow; we just
    // no longer block the spend. A negative result is surfaced as a warning.
    const newBalance = remaining.minus(amount).toDecimalPlaces(2);

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
      data: { currentBalance: newBalance.toString() },
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
    return { voucher, newBalance };
  });

  revalidatePath("/petty-cash");
  revalidatePath(`/petty-cash/floats/${input.floatId}`);
  return {
    ok: true,
    id: result.voucher.id,
    voucherNo: result.voucher.voucherNo,
    ...(result.newBalance.lt(0)
      ? { warning: `Float is now ${formatINR(result.newBalance)} — top it up` }
      : {}),
  };
}

export async function updatePettyCashVoucher(
  id: string,
  raw: unknown,
): Promise<ActionResultWith<{ warning?: string }>> {
  try {
    return await updatePettyCashVoucherInner(id, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function updatePettyCashVoucherInner(
  id: string,
  raw: unknown,
): Promise<{ ok: true; warning?: string }> {
  // Editing a posted voucher rewrites the cash trail, so it's gated like
  // reverse (finance desk), not like create (custodian).
  const session = await requireRole(PETTY_MANAGE);
  const input = PettyCashVoucherUpdateInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    // Resolve the parent float, then lock it BEFORE reading the voucher or
    // the balance — same discipline as reverse: without the lock a
    // concurrent movement and this edit both compute from a stale balance.
    const ref = await tx.pettyCashVoucher.findUnique({
      where: { id },
      select: { floatId: true },
    });
    if (!ref) throw new ActionError("Voucher not found");
    await lockFloatRow(tx, ref.floatId);
    const voucher = await tx.pettyCashVoucher.findUnique({
      where: { id },
      select: {
        id: true,
        floatId: true,
        voucherNo: true,
        amount: true,
        category: true,
        paidTo: true,
        reason: true,
        paidAt: true,
        status: true,
        reversedAt: true,
      },
    });
    if (!voucher) throw new ActionError("Voucher not found");
    if (voucher.reversedAt || voucher.status === PettyCashVoucherStatus.REVERSED) {
      throw new ActionError("Voucher is reversed — reversed vouchers cannot be edited");
    }

    const newAmount = toDecimal(input.amount);
    if (newAmount.lte(0)) throw new ActionError("Voucher amount must be positive");
    const oldAmount = toDecimal(voucher.amount);

    const float = await tx.pettyCashFloat.findUnique({
      where: { id: voucher.floatId },
      select: { currentBalance: true },
    });
    if (!float) throw new ActionError("Parent float missing");

    // Voucher = cash OUT: raising the amount lowers the balance by the
    // difference, lowering it gives the difference back. The float may go
    // negative (IOU situations — #30); we no longer block the edit, only
    // warn when the result lands below zero.
    const balance = toDecimal(float.currentBalance);
    const newBalance = balance.plus(oldAmount).minus(newAmount).toDecimalPlaces(2);

    await tx.pettyCashVoucher.update({
      where: { id },
      data: {
        amount: input.amount,
        category: input.category,
        paidTo: input.paidTo,
        reason: input.reason,
        // Same parse as create — the form sends a local datetime string.
        paidAt: new Date(input.paidAt),
      },
    });
    await tx.pettyCashFloat.update({
      where: { id: voucher.floatId },
      data: { currentBalance: newBalance.toString() },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PETTY_CASH_VOUCHER_UPDATED",
        entity: "PettyCashVoucher",
        entityId: id,
        payloadHash: sha256Json({
          voucherNo: voucher.voucherNo,
          before: {
            amount: oldAmount.toString(),
            category: voucher.category,
            paidTo: voucher.paidTo,
            reason: voucher.reason,
            paidAt: voucher.paidAt.toISOString(),
          },
          after: {
            amount: newAmount.toString(),
            category: input.category,
            paidTo: input.paidTo,
            reason: input.reason,
            paidAt: new Date(input.paidAt).toISOString(),
          },
        }),
      },
    });
    return { floatId: voucher.floatId, newBalance };
  });

  revalidatePath("/petty-cash");
  revalidatePath(`/petty-cash/floats/${result.floatId}`);
  return {
    ok: true,
    ...(result.newBalance.lt(0)
      ? { warning: `Float is now ${formatINR(result.newBalance)} — top it up` }
      : {}),
  };
}

export async function deletePettyCashVoucher(id: string, reason: string): Promise<ActionResult> {
  try {
    return await deletePettyCashVoucherInner(id, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function deletePettyCashVoucherInner(id: string, reason: string): Promise<{ ok: true }> {
  const session = await requireRole(PETTY_MANAGE);
  // Hard delete — the audit row is the ONLY trace, so the reason is mandatory.
  if (!reason.trim()) throw new ActionError("Reason required");

  const floatId = await db.$transaction(async (tx) => {
    const ref = await tx.pettyCashVoucher.findUnique({
      where: { id },
      select: { floatId: true },
    });
    if (!ref) throw new ActionError("Voucher not found");
    await lockFloatRow(tx, ref.floatId);
    const voucher = await tx.pettyCashVoucher.findUnique({
      where: { id },
      select: { id: true, floatId: true, voucherNo: true, amount: true, status: true, reversedAt: true },
    });
    if (!voucher) throw new ActionError("Voucher not found");
    if (voucher.reversedAt || voucher.status === PettyCashVoucherStatus.REVERSED) {
      throw new ActionError("Voucher is reversed — its cash is already restored; deleting it would double-credit the float");
    }

    // Cash went OUT when the voucher was posted — put it back.
    const float = await tx.pettyCashFloat.findUnique({
      where: { id: voucher.floatId },
      select: { currentBalance: true },
    });
    if (!float) throw new ActionError("Parent float missing");
    await tx.pettyCashFloat.update({
      where: { id: voucher.floatId },
      data: {
        currentBalance: toDecimal(float.currentBalance).plus(toDecimal(voucher.amount)).toDecimalPlaces(2).toString(),
      },
    });
    await tx.pettyCashVoucher.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PETTY_CASH_VOUCHER_DELETED",
        entity: "PettyCashVoucher",
        entityId: id,
        payloadHash: sha256Json({
          voucherNo: voucher.voucherNo,
          amount: toDecimal(voucher.amount).toString(),
          reason,
        }),
      },
    });
    return voucher.floatId;
  });

  revalidatePath("/petty-cash");
  revalidatePath(`/petty-cash/floats/${floatId}`);
  return { ok: true };
}

export async function reversePettyCashVoucher(id: string, reason: string): Promise<ActionResult> {
  try {
    return await reversePettyCashVoucherInner(id, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function reversePettyCashVoucherInner(id: string, reason: string): Promise<{ ok: true }> {
  const session = await requireRole(PETTY_MANAGE);
  if (!reason.trim()) throw new ActionError("Reason required");
  await db.$transaction(async (tx) => {
    // Resolve the parent float, then lock it BEFORE reading the voucher's
    // status or the float's balance — two concurrent reversals of the same
    // voucher would otherwise both see POSTED and credit the float twice.
    const ref = await tx.pettyCashVoucher.findUnique({
      where: { id },
      select: { floatId: true },
    });
    if (!ref) throw new ActionError("Voucher not found");
    await lockFloatRow(tx, ref.floatId);
    const voucher = await tx.pettyCashVoucher.findUnique({
      where: { id },
      select: { id: true, floatId: true, amount: true, status: true, reversedAt: true },
    });
    if (!voucher) throw new ActionError("Voucher not found");
    if (voucher.reversedAt || voucher.status === PettyCashVoucherStatus.REVERSED) {
      throw new ActionError("Voucher already reversed");
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
    if (!float) throw new ActionError("Parent float missing");
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
  return { ok: true };
}

// ─── Top-up ──────────────────────────────────────────────────────────────

export async function topUpPettyCash(raw: unknown): Promise<ActionResult> {
  try {
    return await topUpPettyCashInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function topUpPettyCashInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(PETTY_MANAGE);
  const input = PettyCashTopUpInput.parse(raw);
  const amount = toDecimal(input.amount);
  if (amount.lte(0)) throw new ActionError("Top-up amount must be positive");

  // The threshold is a BREADCRUMB, not a gate: an over-limit top-up is
  // posted like any other and only reads differently in the audit trail.
  // Nobody countersigns it — PETTY_MANAGE admits ACCOUNTS, and the row below
  // records the poster as its own approver, so the finance desk refilling
  // the tin from the bank signs for itself. That is the client's call to
  // change; if a second signature is ever wanted it belongs here, gated.
  const overThreshold = amount.gt(TOPUP_APPROVAL_THRESHOLD);

  await db.$transaction(async (tx) => {
    await lockFloatRow(tx, input.floatId);
    const float = await tx.pettyCashFloat.findUnique({
      where: { id: input.floatId },
      select: { id: true, currentBalance: true, active: true },
    });
    if (!float || !float.active) throw new ActionError("Float not found or inactive");
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
        action: overThreshold ? "PETTY_CASH_TOP_UP_OVER_THRESHOLD" : "PETTY_CASH_TOP_UP",
        entity: "PettyCashFloat",
        entityId: float.id,
        payloadHash: sha256Json({ amount: input.amount, source: input.source }),
      },
    });
  });

  revalidatePath("/petty-cash");
  revalidatePath(`/petty-cash/floats/${input.floatId}`);
  return { ok: true };
}

// ─── Report ──────────────────────────────────────────────────────────────

export type PettyCashMovementKind = "VOUCHER_OUT" | "TOPUP_IN" | "REVERSAL_IN";

export type PettyCashMovement = {
  id: string;
  kind: PettyCashMovementKind;
  date: Date;
  floatId: string;
  floatName: string;
  /** Voucher number, or the top-up's bank reference. */
  refNo: string | null;
  /** Voucher category / top-up source. */
  detail: string;
  paidTo: string | null;
  /** Signed: negative = cash out of the float, positive = cash in. */
  amount: string;
};

/**
 * Movement ledger for the report page: vouchers (out), top-ups (in) and
 * voucher reversals (in) within [from, to], newest first. A voucher that
 * was reversed shows up twice — the original outflow at paidAt and the
 * reversal inflow at reversedAt — so the running story matches the cash tin.
 */
export async function getPettyCashReport(params: { floatId?: string; from: Date; to: Date }) {
  await requireRole(PETTY_MANAGE);
  const floatFilter = params.floatId ? { floatId: params.floatId } : {};
  const range = { gte: params.from, lte: params.to };

  const [floats, vouchers, reversals, topUps] = await Promise.all([
    db.pettyCashFloat.findMany({
      where: { active: true },
      select: { id: true, name: true, currentBalance: true },
      orderBy: { name: "asc" },
    }),
    db.pettyCashVoucher.findMany({
      where: { ...floatFilter, paidAt: range },
      include: { float: { select: { name: true } } },
    }),
    db.pettyCashVoucher.findMany({
      where: { ...floatFilter, status: PettyCashVoucherStatus.REVERSED, reversedAt: range },
      include: { float: { select: { name: true } } },
    }),
    db.pettyCashTopUp.findMany({
      where: { ...floatFilter, createdAt: range },
      include: { float: { select: { name: true } } },
    }),
  ]);

  const movements: PettyCashMovement[] = [
    ...vouchers.map((v) => ({
      id: `voucher-${v.id}`,
      kind: "VOUCHER_OUT" as const,
      date: v.paidAt,
      floatId: v.floatId,
      floatName: v.float.name,
      refNo: v.voucherNo,
      detail: v.category,
      paidTo: v.paidTo,
      amount: toDecimal(v.amount).negated().toString(),
    })),
    ...reversals.map((v) => ({
      id: `reversal-${v.id}`,
      kind: "REVERSAL_IN" as const,
      date: v.reversedAt ?? v.paidAt,
      floatId: v.floatId,
      floatName: v.float.name,
      refNo: v.voucherNo,
      detail: v.reversedReason ?? v.category,
      paidTo: v.paidTo,
      amount: toDecimal(v.amount).toString(),
    })),
    ...topUps.map((t) => ({
      id: `topup-${t.id}`,
      kind: "TOPUP_IN" as const,
      date: t.createdAt,
      floatId: t.floatId,
      floatName: t.float.name,
      refNo: t.reference,
      detail: t.source,
      paidTo: null,
      amount: toDecimal(t.amount).toString(),
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const cashOut = vouchers.reduce((s, v) => s.plus(toDecimal(v.amount)), toDecimal(0));
  const cashIn = [...reversals, ...topUps].reduce((s, r) => s.plus(toDecimal(r.amount)), toDecimal(0));

  return {
    movements,
    totals: {
      cashOut: cashOut.toString(),
      cashIn: cashIn.toString(),
      net: cashIn.minus(cashOut).toString(),
    },
    floats: floats.map((f) => ({
      id: f.id,
      name: f.name,
      currentBalance: toDecimal(f.currentBalance).toString(),
    })),
  };
}
