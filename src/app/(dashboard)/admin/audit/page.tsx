import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string }>;
}) {
  await requireRole([Role.ADMIN]);
  const sp = await searchParams;

  const rows = await db.auditLog.findMany({
    where: {
      ...(sp.entity ? { entity: sp.entity } : {}),
      ...(sp.action ? { action: { contains: sp.action, mode: "insensitive" } } : {}),
    },
    orderBy: { at: "desc" },
    take: 200,
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        description="Every consequential mutation writes one row in the same transaction. Read-only here; full search lands in Phase 2."
      />

      <form className="mb-3 flex flex-wrap items-end gap-2" action="/admin/audit">
        <input
          name="entity"
          defaultValue={sp.entity ?? ""}
          placeholder="Entity (e.g. Order)"
          className="h-9 w-48 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <input
          name="action"
          defaultValue={sp.action ?? ""}
          placeholder="Action (e.g. APPROVED)"
          className="h-9 w-56 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <button type="submit" className="rounded-md border border-ik-rule bg-ik-paper-alt px-3 py-1 text-[13px]">Filter</button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>At (IST)</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Entity ID</TableHead>
            <TableHead>Payload hash</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-[12px]">{formatIST(r.at)}</TableCell>
              <TableCell className="text-[12.5px]">{r.user?.name ?? "—"}</TableCell>
              <TableCell className="font-mono text-[12px]">{r.action}</TableCell>
              <TableCell>{r.entity}</TableCell>
              <TableCell className="font-mono text-[11px] text-ik-ink-3">{r.entityId}</TableCell>
              <TableCell className="font-mono text-[10px] text-ik-ink-3 truncate max-w-[140px]" title={r.payloadHash ?? ""}>
                {r.payloadHash ? r.payloadHash.slice(0, 12) + "…" : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
