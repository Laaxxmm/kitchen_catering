"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { sha256Json } from "@/lib/audit";

const ADMIN_ONLY = [Role.ADMIN];

export async function listSettings() {
  await requireRole(ADMIN_ONLY);
  return db.settings.findMany({ orderBy: { key: "asc" } });
}

export async function upsertSetting(key: string, value: unknown, notes?: string | null) {
  const session = await requireRole(ADMIN_ONLY);
  if (!key.trim()) throw new Error("Key is required");

  await db.$transaction(async (tx) => {
    await tx.settings.upsert({
      where: { key },
      create: { key, value: value as never, notes: notes ?? null },
      update: { value: value as never, notes: notes ?? null },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SETTING_UPSERTED",
        entity: "Settings",
        entityId: key,
        payloadHash: sha256Json({ key, value }),
      },
    });
  });
  revalidatePath("/admin/settings");
}
