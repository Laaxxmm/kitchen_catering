import { StoreDepartment } from "@prisma/client";
import { AuthenticationError, requireSession } from "@/server/rbac";
import { UPLOAD_ROLES, templateCsv } from "@/server/dept-stock-upload";

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

  return new Response(templateCsv(dept), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dept.toLowerCase()}-stock-template.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
