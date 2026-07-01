import { Role } from "@prisma/client";
import { auth } from "@/server/auth";

// Reports carry financial data — restricted to management + the books desk.
const REPORT_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];

/**
 * Gate a report route handler. Returns a 401/403 Response to short-circuit, or
 * null when the caller is allowed.
 */
export async function gateReport(): Promise<Response | null> {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!REPORT_ROLES.includes(session.user.role)) return new Response("Forbidden", { status: 403 });
  return null;
}

/**
 * Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD into a UTC-ish date window. Missing
 * bounds default to the last 90 days → now. `to` is pushed to end-of-day so
 * the whole day is included.
 */
export function parseRange(url: string): { from: Date; to: Date; label: string } {
  const sp = new URL(url).searchParams;
  const now = new Date();
  const fromStr = sp.get("from");
  const toStr = sp.get("to");
  const from = fromStr ? new Date(fromStr + "T00:00:00") : new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  const to = toStr ? new Date(toStr + "T23:59:59") : now;
  const label = `${fromStr ?? from.toISOString().slice(0, 10)}_to_${toStr ?? to.toISOString().slice(0, 10)}`;
  return { from, to, label };
}
