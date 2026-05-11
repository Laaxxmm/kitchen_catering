"use server";

import { revalidatePath } from "next/cache";
import { Role, VendorCategory, VendorPaymentTerms } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { VendorInput, type VendorInputT } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import { nextVendorCode } from "@/lib/sequences";

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

export async function createVendor(raw: unknown) {
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
  return { id: vendor.id, code: vendor.code };
}

export async function updateVendor(id: string, raw: unknown) {
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
}

export async function deactivateVendor(id: string) {
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
