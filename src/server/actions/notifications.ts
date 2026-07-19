"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireSession, requireRole } from "@/server/rbac";

// In-app notification read/mark APIs. Every export here is session-gated —
// a user can only touch their own rows. Notification *creation*
// (createNotification / notifyRoles) lives in @/server/notification-core,
// a non-"use server" module, so it can't be invoked as a client endpoint
// (AUDIT_REPORT M1/M2).

// ─── Read APIs ────────────────────────────────────────────────────────

export async function listMyNotifications(opts: { limit?: number } = {}) {
  const session = await requireSession();
  return db.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
  });
}

export async function myUnreadCount(): Promise<number> {
  const session = await requireSession();
  return db.notification.count({
    where: { userId: session.user.id, readAt: null },
  });
}

export async function markNotificationRead(id: string) {
  const session = await requireSession();
  await db.notification.updateMany({
    where: { id, userId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

export async function markAllNotificationsRead() {
  const session = await requireSession();
  await db.notification.updateMany({
    where: { userId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

/**
 * Admin-only: clear all notifications (cleanup hook). Used sparingly.
 */
export async function purgeOldNotifications(olderThanDays = 60) {
  await requireRole([Role.ADMIN]);
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600 * 1000);
  const result = await db.notification.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: result.count };
}
