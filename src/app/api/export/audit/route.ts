import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateExport } from "@/lib/exports/report-util";
import { formatIST, istToUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Audit log as Excel — who did what, when. Honours the same entity / action
 *  / from / to filters as the on-screen page. ?entity=&action=&from=&to= */
export async function GET(req: Request) {
  const denied = await gateExport([Role.ADMIN, Role.MANAGER]);
  if (denied) return denied;

  const q = new URL(req.url).searchParams;
  const entity = q.get("entity") || undefined;
  const action = q.get("action") || undefined;
  const fromStr = q.get("from");
  const toStr = q.get("to");
  const from = fromStr && DATE_RE.test(fromStr) ? istToUtc(fromStr) : undefined;
  const to = toStr && DATE_RE.test(toStr) ? istToUtc(`${toStr}T23:59:59.999`) : undefined;

  const rows = await db.auditLog.findMany({
    where: {
      ...(entity ? { entity } : {}),
      ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
      ...(from || to ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    orderBy: { at: "desc" },
    take: 50000,
    include: { user: { select: { name: true, email: true } } },
  });

  const data = rows.map((r) => [
    formatIST(r.at, "yyyy-MM-dd HH:mm:ss"),
    r.user?.name ?? "",
    r.user?.email ?? "",
    r.action,
    r.entity,
    r.entityId,
    r.payloadHash ?? "",
  ]);

  const buf = await buildWorkbook([
    { name: "Audit log", header: ["At (IST)", "User", "Email", "Action", "Entity", "Entity ID", "Payload hash"], rows: data },
  ]);
  return xlsxResponse(buf, "audit-log.xlsx");
}
