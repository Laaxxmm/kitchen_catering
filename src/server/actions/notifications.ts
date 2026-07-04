"use server";

import { revalidatePath } from "next/cache";
import { NotificationKind, Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireSession, requireRole } from "@/server/rbac";

// In-app notifications. Anyone signed in can read their own; only the
// system (server actions) creates them via createNotification — there's
// no UI for users to send each other a notification.

interface CreateNotificationInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Optional stable de-dup key — when set, repeating the same call
   *  doesn't create a duplicate row (relies on the
   *  @@unique([userId, dedupeKey]) constraint). */
  dedupeKey?: string | null;
}

/**
 * Create a notification for one user. Used by server actions hooking
 * into key transitions. Silently swallows the duplicate-key error so
 * idempotent re-fires don't crash the caller.
 */
export async function createNotification(input: CreateNotificationInput) {
  try {
    await db.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
    });
  } catch (err) {
    // P2002 = unique constraint violation. dedupeKey collision is the
    // expected "already notified" path — drop it.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return;
    }
    // Any other error: swallow but log, so notification plumbing never
    // takes down a real business action.
    console.warn("[notify] createNotification failed", err);
  }
}

/**
 * Fan-out helper — send the same notification to every user with one
 * of the listed roles. Caller deduplicates via dedupeKey.
 */
export async function notifyRoles(
  roles: Role[],
  payload: Omit<CreateNotificationInput, "userId">,
) {
  // Never let notification plumbing take down the business action that
  // triggered it — swallow and log, same contract as createNotification.
  let recipients: Array<{ id: string }> = [];
  try {
    recipients = await db.user.findMany({
      where: { role: { in: roles }, active: true },
      select: { id: true },
    });
  } catch (err) {
    console.warn("[notify] notifyRoles recipient lookup failed", err);
    return;
  }
  await Promise.all(
    recipients.map((r) => createNotification({ ...payload, userId: r.id })),
  );
}

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
