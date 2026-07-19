"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { DeliveryStatus, Role, TaskStatus } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { UserInput, UserUpdateInput } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

const ADMIN_ONLY = [Role.ADMIN];

export async function createUser(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await createUserInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createUserInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(ADMIN_ONLY);
  const input = UserInput.parse(raw);
  if (!input.password) throw new ActionError("Password is required when creating a user");
  if (input.password.length < 8) throw new ActionError("Password must be at least 8 characters");

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        phone: input.phone ?? null,
        passwordHash,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "USER_CREATED",
        entity: "User",
        entityId: created.id,
        payloadHash: sha256Json({ email: input.email, role: input.role }),
      },
    });
    return created;
  });

  revalidatePath("/admin/users");
  return { ok: true, id: user.id };
}

export async function updateUser(id: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(ADMIN_ONLY);
    const input = UserUpdateInput.parse(raw);

    await db.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (input.email) data.email = input.email;
      if (input.name) data.name = input.name;
      if (input.role) data.role = input.role;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.active !== undefined) data.active = input.active;
      if (input.password) {
        if (input.password.length < 8) throw new ActionError("Password must be at least 8 characters");
        data.passwordHash = await bcrypt.hash(input.password, 12);
      }
      await tx.user.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "USER_UPDATED",
          entity: "User",
          entityId: id,
        },
      });
    });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function deactivateUser(
  id: string,
): Promise<ActionResultWith<{ warning?: string }>> {
  try {
    const session = await requireRole(ADMIN_ONLY);
    if (id === session.user.id) throw new ActionError("You cannot deactivate yourself");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { active: false } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "USER_DEACTIVATED",
          entity: "User",
          entityId: id,
        },
      });
    });

    // L11: surface work still assigned to the deactivated user so the
    // admin reassigns it instead of it silently going stale.
    const [openTasks, activeDeliveries] = await Promise.all([
      db.task.count({
        where: {
          assignedToId: id,
          status: { in: [TaskStatus.ASSIGNED, TaskStatus.SUBMITTED, TaskStatus.REJECTED] },
        },
      }),
      db.delivery.count({
        where: {
          driverUserId: id,
          status: {
            in: [DeliveryStatus.SCHEDULED, DeliveryStatus.DISPATCHED, DeliveryStatus.IN_TRANSIT],
          },
        },
      }),
    ]);
    let warning: string | undefined;
    if (openTasks > 0 || activeDeliveries > 0) {
      const parts: string[] = [];
      if (openTasks > 0) parts.push(`${openTasks} open task${openTasks === 1 ? "" : "s"}`);
      if (activeDeliveries > 0) {
        parts.push(`${activeDeliveries} active deliver${activeDeliveries === 1 ? "y" : "ies"}`);
      }
      warning = `They still have ${parts.join(" and ")} — reassign from the Tasks / Deliveries screens.`;
    }

    revalidatePath("/admin/users");
    return { ok: true, warning };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function listUsers(opts: { active?: boolean } = {}) {
  await requireRole(ADMIN_ONLY);
  return db.user.findMany({
    where: opts.active !== undefined ? { active: opts.active } : {},
    select: {
      id: true, email: true, name: true, role: true, phone: true, active: true,
      createdAt: true, updatedAt: true,
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Lightweight active-user list for assignment pickers (task/feedback
 * allocation, petty-cash custodian). Managers + accounts can read it — unlike
 * the full admin listUsers, which is ADMIN-only and would crash those pages.
 */
export async function listAssignableUsers() {
  await requireRole([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  return db.user.findMany({
    where: { active: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}

export async function getUser(id: string) {
  await requireRole(ADMIN_ONLY);
  return db.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, role: true, phone: true, active: true,
    },
  });
}
