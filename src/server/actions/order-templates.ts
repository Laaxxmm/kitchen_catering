"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { OrderTemplateInput } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

// Recurring-order templates are a management tool (client item #2): the
// manager curates them, then places an order from one in a couple of taps.
const TEMPLATE_ROLES = [Role.ADMIN, Role.MANAGER];

export async function listOrderTemplates(opts: { activeOnly?: boolean } = {}) {
  await requireRole(TEMPLATE_ROLES);
  return db.orderTemplate.findMany({
    where: opts.activeOnly === false ? {} : { active: true },
    include: {
      customer: { select: { name: true } },
      items: { include: { dish: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
      _count: { select: { items: true } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function getOrderTemplate(id: string) {
  await requireRole(TEMPLATE_ROLES);
  return db.orderTemplate.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      items: { include: { dish: { select: { id: true, name: true } } }, orderBy: { sortOrder: "asc" } },
    },
  });
}

/** Create (no id) or fully replace (id) a template, items included. */
export async function upsertOrderTemplate(
  raw: unknown,
  id?: string,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(TEMPLATE_ROLES);
    const input = OrderTemplateInput.parse(raw);
    if (input.items.length === 0) {
      throw new ActionError("Add at least one dish to the template.");
    }

    const row = await db.$transaction(async (tx) => {
      const data = {
        name: input.name,
        customerId: input.customerId,
        channel: input.channel,
        mealType: input.mealType,
        headcount: input.headcount,
        packageTotal: input.packageTotal?.trim() ? input.packageTotal : null,
        deliveryAddress: input.deliveryAddress ?? null,
        notes: input.notes ?? null,
      };
      const items = input.items.map((it, idx) => ({
        dishId: it.dishId,
        portions: it.portions.trim() || "1",
        sortOrder: idx,
      }));
      let saved;
      if (id) {
        saved = await tx.orderTemplate.update({ where: { id }, data });
        // Full replace keeps the editor simple — templates carry no history.
        await tx.orderTemplateItem.deleteMany({ where: { templateId: id } });
        await tx.orderTemplateItem.createMany({ data: items.map((it) => ({ ...it, templateId: id })) });
      } else {
        saved = await tx.orderTemplate.create({
          data: { ...data, createdById: session.user.id, items: { create: items } },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: id ? "ORDER_TEMPLATE_UPDATED" : "ORDER_TEMPLATE_CREATED",
          entity: "OrderTemplate",
          entityId: saved.id,
          payloadHash: sha256Json({ name: input.name, items: input.items.length }),
        },
      });
      return saved;
    });

    revalidatePath("/orders/templates");
    return { ok: true, id: row.id };
  } catch (err) {
    return actionFailure(err);
  }
}

/** Soft-remove — the template disappears from the picker, orders it created
 *  are untouched. */
export async function deactivateOrderTemplate(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(TEMPLATE_ROLES);
    await db.$transaction(async (tx) => {
      await tx.orderTemplate.update({ where: { id }, data: { active: false } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ORDER_TEMPLATE_DEACTIVATED",
          entity: "OrderTemplate",
          entityId: id,
        },
      });
    });
    revalidatePath("/orders/templates");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}
