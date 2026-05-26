"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { CustomerInput, type CustomerInputT } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.SALES];
const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.SALES, Role.ACCOUNTS, Role.KITCHEN_HEAD, Role.STORE_KEEPER];

/**
 * Credit-duration approval rule from the Workflow doc:
 *   creditDays = 0          → cash; any sales/manager/admin can create
 *   creditDays 1..15        → manager or admin only
 *   creditDays > 15         → admin only
 *
 * Returns null when allowed, or a human-readable reason when not.
 */
function checkCreditDurationGate(role: Role, creditDays: number | undefined): string | null {
  const days = creditDays ?? 0;
  if (days === 0) return null;
  if (days <= 15) {
    if (role === Role.SALES) {
      return "Credit duration 1–15 days needs manager or admin approval. Ask a manager to create / update this customer.";
    }
    return null;
  }
  // days > 15
  if (role !== Role.ADMIN) {
    return "Credit duration >15 days needs admin approval. Ask an admin to create / update this customer.";
  }
  return null;
}

function customerDataFromInput(input: CustomerInputT) {
  return {
    name: input.name,
    gstin: input.gstin ?? null,
    pan: input.pan ?? null,
    billingAddress: input.billingAddress,
    shippingAddress: input.shippingAddress ?? null,
    stateCode: input.stateCode,
    contactName: input.contactName ?? null,
    email: input.email ?? null,
    // Phone is now required by the validator; pass straight through.
    phone: input.phone,
    notes: input.notes ?? null,
    groupId: input.groupId ?? null,
    defaultTdsRatePct: input.defaultTdsRatePct ?? null,
    defaultTdsSection: input.defaultTdsSection ?? null,
    billingCompanyName: input.billingCompanyName ?? null,
    ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
    ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
    ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms } : {}),
  };
}

export async function createCustomer(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = CustomerInput.parse(raw);
  const block = checkCreditDurationGate(session.user.role, input.creditDays);
  if (block) throw new Error(block);

  const customer = await db.$transaction(async (tx) => {
    const row = await tx.customer.create({ data: customerDataFromInput(input) });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_CREATED",
        entity: "Customer",
        entityId: row.id,
        payloadHash: sha256Json({ name: input.name, gstin: input.gstin }),
      },
    });
    return row;
  });

  revalidatePath("/customers");
  return { id: customer.id };
}

export async function updateCustomer(id: string, raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = CustomerInput.parse(raw);
  const block = checkCreditDurationGate(session.user.role, input.creditDays);
  if (block) throw new Error(block);

  await db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id }, data: customerDataFromInput(input) });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_UPDATED",
        entity: "Customer",
        entityId: id,
        payloadHash: sha256Json({ name: input.name, gstin: input.gstin }),
      },
    });
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}

export async function deactivateCustomer(id: string) {
  const session = await requireRole([Role.ADMIN, Role.MANAGER]);
  await db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_DEACTIVATED",
        entity: "Customer",
        entityId: id,
      },
    });
  });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}

export async function reactivateCustomer(id: string) {
  const session = await requireRole([Role.ADMIN, Role.MANAGER]);
  await db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id }, data: { active: true } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_REACTIVATED",
        entity: "Customer",
        entityId: id,
      },
    });
  });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}

export async function listCustomers(opts: { query?: string; active?: boolean; groupId?: string | null } = {}) {
  await requireRole(READ_ROLES);
  return db.customer.findMany({
    where: {
      ...(opts.active !== undefined ? { active: opts.active } : {}),
      ...(opts.groupId === null
        ? { groupId: null }
        : opts.groupId !== undefined
          ? { groupId: opts.groupId }
          : {}),
      ...(opts.query
        ? {
            OR: [
              { name: { contains: opts.query, mode: "insensitive" } },
              { gstin: { contains: opts.query, mode: "insensitive" } },
              { contactName: { contains: opts.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { group: true },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function getCustomer(id: string) {
  await requireRole(READ_ROLES);
  return db.customer.findUnique({ where: { id }, include: { group: true } });
}
