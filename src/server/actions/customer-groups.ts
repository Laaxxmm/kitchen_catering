"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { CustomerGroupInput } from "@/lib/validators";
import {
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER];

export async function createCustomerGroup(
  raw: unknown,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(WRITE_ROLES);
    const input = CustomerGroupInput.parse(raw);

    const group = await db.$transaction(async (tx) => {
      const row = await tx.customerGroup.create({
        data: {
          name: input.name,
          slug: input.slug ?? null,
          description: input.description ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "CUSTOMER_GROUP_CREATED",
          entity: "CustomerGroup",
          entityId: row.id,
        },
      });
      return row;
    });

    revalidatePath("/customers/groups");
    return { ok: true, id: group.id };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function updateCustomerGroup(id: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    const input = CustomerGroupInput.parse(raw);

    await db.$transaction(async (tx) => {
      await tx.customerGroup.update({
        where: { id },
        data: {
          name: input.name,
          slug: input.slug ?? null,
          description: input.description ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "CUSTOMER_GROUP_UPDATED",
          entity: "CustomerGroup",
          entityId: id,
        },
      });
    });

    revalidatePath("/customers/groups");
    revalidatePath(`/customers/groups/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function deactivateCustomerGroup(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    await db.$transaction(async (tx) => {
      await tx.customerGroup.update({ where: { id }, data: { active: false } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "CUSTOMER_GROUP_DEACTIVATED",
          entity: "CustomerGroup",
          entityId: id,
        },
      });
    });
    revalidatePath("/customers/groups");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function listCustomerGroups(opts: { active?: boolean } = {}) {
  await requireRole([...WRITE_ROLES, Role.SALES, Role.ACCOUNTS]);
  return db.customerGroup.findMany({
    where: opts.active !== undefined ? { active: opts.active } : {},
    include: { _count: { select: { customers: true } } },
    orderBy: { name: "asc" },
  });
}
