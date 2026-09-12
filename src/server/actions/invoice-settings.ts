"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { sha256Json } from "@/lib/audit";
import { InvoiceBankDetailsInput, InvoiceCompanyDetailsInput } from "@/lib/validators";
import { actionFailure, type ActionResult } from "@/server/action-result";

/**
 * Save the bank details printed on customer invoices (Settings key
 * "invoice.bankDetails"). Separate from the ADMIN-only generic settings
 * action because managers may maintain this too. The invoice PDF reads
 * the same key in src/server/pdf/customer-invoice.tsx.
 */
export async function saveInvoiceBankDetails(raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole([Role.ADMIN, Role.MANAGER]);
    const input = InvoiceBankDetailsInput.parse(raw);
    await db.$transaction(async (tx) => {
      await tx.settings.upsert({
        where: { key: "invoice.bankDetails" },
        create: {
          key: "invoice.bankDetails",
          value: input as never,
          notes: "Bank details printed on customer invoices",
        },
        update: { value: input as never },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "SETTING_UPSERTED",
          entity: "Settings",
          entityId: "invoice.bankDetails",
          payloadHash: sha256Json(input),
        },
      });
    });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Save the seller block printed at the head of every customer invoice
 * (Settings key "invoice.company": name, address, email, phone, mobile,
 * GSTIN). Same desk as the bank details. A blank field falls back to the
 * INDEFINE_* env value in src/server/pdf/customer-invoice.tsx.
 */
export async function saveInvoiceCompanyDetails(raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole([Role.ADMIN, Role.MANAGER]);
    const input = InvoiceCompanyDetailsInput.parse(raw);
    await db.$transaction(async (tx) => {
      await tx.settings.upsert({
        where: { key: "invoice.company" },
        create: {
          key: "invoice.company",
          value: input as never,
          notes: "Company details printed at the head of customer invoices",
        },
        update: { value: input as never },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "SETTING_UPSERTED",
          entity: "Settings",
          entityId: "invoice.company",
          payloadHash: sha256Json(input),
        },
      });
    });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}
