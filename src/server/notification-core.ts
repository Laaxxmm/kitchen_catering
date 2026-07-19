import { NotificationKind, Role } from "@prisma/client";
import { db } from "@/server/db";

// Notification creation internals. This is NOT a "use server" module, so
// nothing here is a callable client endpoint — createNotification/notifyRoles
// can only be reached from other server code. The public actions module
// (@/server/actions/notifications) exposes just the session-gated read/mark
// APIs. See AUDIT_REPORT M1/M2.

export interface CreateNotificationInput {
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
