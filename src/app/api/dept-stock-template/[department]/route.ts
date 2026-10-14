import { StoreDepartment } from "@prisma/client";
import { AuthenticationError, requireSession } from "@/server/rbac";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { UPLOAD_ROLES, templateSheet } from "@/server/dept-stock-upload";

export const dynamic = "force-dynamic";

const BY_SLUG = new Map<string, StoreDepartment>([
  ["housekeeping", StoreDepartment.HOUSEKEEPING],
  ["maintenance", StoreDepartment.MAINTENANCE],
]);

/**
 * The blank stock-upload template for one department. Route handlers sit
 * outside the page gates, so this checks the session and the department
 * isolation itself — the same roles as the upload action.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ department: string }> }) {
  const dept = BY_SLUG.get((await params).department);
  if (!dept) return new Response("Not found", { status: 404 });
  let role;
  try {
    role = (await requireSession()).user.role;
  } catch (e) {
    if (e instanceof AuthenticationError) return new Response("Unauthorized", { status: 401 });
    throw e;
  }
  if (!UPLOAD_ROLES[dept].includes(role)) return new Response("Forbidden", { status: 403 });

  const { header, example } = templateSheet(dept);
  const buf = await buildWorkbook([
    { name: "Stock", header, rows: [example], widths: header.map((h, i) => (i === 0 ? 40 : Math.max(14, h.length + 4))) },
  ]);
  return xlsxResponse(buf, `${dept.toLowerCase()}-stock-template.xlsx`);
}
