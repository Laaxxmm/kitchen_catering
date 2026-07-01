"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { UserInput, UserUpdateInput } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";

const ADMIN_ONLY = [Role.ADMIN];

export async function createUser(raw: unknown) {
  const session = await requireRole(ADMIN_ONLY);
  const input = UserInput.parse(raw);
  if (!input.password) throw new Error("Password is required when creating a user");
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters");

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
  return { id: user.id };
}

export async function updateUser(id: string, raw: unknown) {
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
      if (input.password.length < 8) throw new Error("Password must be at least 8 characters");
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
}

export async function deactivateUser(id: string) {
  const session = await requireRole(ADMIN_ONLY);
  if (id === session.user.id) throw new Error("You cannot deactivate yourself");
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
  revalidatePath("/admin/users");
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
