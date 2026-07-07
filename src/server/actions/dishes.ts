"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { DishInput } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import {
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD];
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.KITCHEN_HEAD, Role.STORE_KEEPER, Role.ACCOUNTS,
  // F&B Service (role DELIVERY, FNB_SERVICE its retired alias) picks dishes
  // when taking room-service / à la carte / management orders.
  Role.DELIVERY, Role.FNB_SERVICE,
];

export async function createDish(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await createDishInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createDishInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = DishInput.parse(raw);

  const dish = await db.$transaction(async (tx) => {
    const row = await tx.dish.create({
      data: {
        code: input.code ?? null,
        name: input.name,
        category: input.category ?? null,
        description: input.description ?? null,
        unitPrice: input.unitPrice,
        unit: input.unit ?? "portion",
        hsnSac: input.hsnSac ?? null,
        gstRatePct: input.gstRatePct ?? "5",
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DISH_CREATED",
        entity: "Dish",
        entityId: row.id,
        payloadHash: sha256Json({ code: input.code, name: input.name }),
      },
    });
    return row;
  });
  revalidatePath("/dishes");
  return { ok: true, id: dish.id };
}

export async function updateDish(id: string, raw: unknown): Promise<ActionResult> {
  try {
    return await updateDishInner(id, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function updateDishInner(id: string, raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = DishInput.parse(raw);
  await db.$transaction(async (tx) => {
    await tx.dish.update({
      where: { id },
      data: {
        code: input.code ?? null,
        name: input.name,
        category: input.category ?? null,
        description: input.description ?? null,
        unitPrice: input.unitPrice,
        unit: input.unit ?? "portion",
        hsnSac: input.hsnSac ?? null,
        gstRatePct: input.gstRatePct ?? "5",
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DISH_UPDATED",
        entity: "Dish",
        entityId: id,
      },
    });
  });
  revalidatePath("/dishes");
  revalidatePath(`/dishes/${id}`);
  return { ok: true };
}

export async function deactivateDish(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(WRITE_ROLES);
    await db.$transaction(async (tx) => {
      await tx.dish.update({ where: { id }, data: { active: false } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DISH_DEACTIVATED",
          entity: "Dish",
          entityId: id,
        },
      });
    });
    revalidatePath("/dishes");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function listDishes(opts: { query?: string; active?: boolean } = {}) {
  await requireRole(READ_ROLES);
  return db.dish.findMany({
    where: {
      ...(opts.active !== undefined ? { active: opts.active } : {}),
      ...(opts.query
        ? {
            OR: [
              { name: { contains: opts.query, mode: "insensitive" } },
              { code: { contains: opts.query, mode: "insensitive" } },
              { category: { contains: opts.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 300,
  });
}

export async function getDish(id: string) {
  await requireRole(READ_ROLES);
  return db.dish.findUnique({
    where: { id },
    include: {
      recipe: {
        include: {
          ingredients: { include: { ingredient: { select: { name: true, unit: true } } } },
        },
      },
    },
  });
}
