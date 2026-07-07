import { auth } from "@/server/auth";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/unread-count — the bell polls this every 30s.
 *
 * Deliberately a route handler, NOT a server action: a stale browser tab
 * (loaded on an older build) polling a server action spams the server logs
 * with "Failed to find Server Action" after every redeploy. A plain route
 * has a stable URL, so old tabs keep working across deploys.
 */
// Build fingerprint so open tabs can detect a redeploy. A tab loaded on an
// older build holds stale server-action IDs — every click then fails with
// "Server Action not found" until the user refreshes. Railway injects the
// commit SHA; the boot-time fallback still changes on every restart, which
// at worst prompts one harmless refresh.
const BUILD_FINGERPRINT = process.env.RAILWAY_GIT_COMMIT_SHA ?? `boot-${Date.now()}`;

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ count: 0, build: BUILD_FINGERPRINT });
  const count = await db.notification.count({
    where: { userId: session.user.id, readAt: null },
  });
  return Response.json({ count, build: BUILD_FINGERPRINT });
}
