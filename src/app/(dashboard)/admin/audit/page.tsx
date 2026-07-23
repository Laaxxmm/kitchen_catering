import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { formatIST, istToUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string; from?: string; to?: string }>;
}) {
  await requireRole([Role.ADMIN, Role.MANAGER]);
  const sp = await searchParams;

  const from = sp.from && DATE_RE.test(sp.from) ? istToUtc(sp.from) : undefined;
  const to = sp.to && DATE_RE.test(sp.to) ? istToUtc(`${sp.to}T23:59:59.999`) : undefined;
  const where = {
    ...(sp.entity ? { entity: sp.entity } : {}),
    ...(sp.action ? { action: { contains: sp.action, mode: "insensitive" as const } } : {}),
    ...(from || to ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { at: "desc" },
    take: 500,
    include: { user: { select: { name: true, email: true } } },
  });

  const dlQs = new URLSearchParams();
  for (const [k, v] of Object.entries({ entity: sp.entity, action: sp.action, from: sp.from, to: sp.to })) {
    if (v) dlQs.set(k, v);
  }
  const dl = `/api/export/audit${dlQs.toString() ? `?${dlQs}` : ""}`;

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        description="Every consequential mutation writes one row in the same transaction — who did what, when. Filter by entity, action or date; download for the record."
        actions={<a href={dl} download><Button>Download Excel</Button></a>}
      />

      <form className="mb-3 flex flex-wrap items-end gap-2" action="/admin/audit">
        <input
          name="entity"
          defaultValue={sp.entity ?? ""}
          placeholder="Entity (e.g. Order)"
          className="h-9 w-40 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <input
          name="action"
          defaultValue={sp.action ?? ""}
          placeholder="Action (e.g. APPROVED)"
          className="h-9 w-48 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <div className="grid gap-1">
          <label htmlFor="from" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">From</label>
          <input id="from" type="date" name="from" defaultValue={sp.from ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="to" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">To</label>
          <input id="to" type="date" name="to" defaultValue={sp.to ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <Button type="submit" variant="outline" size="sm">Filter</Button>
        {(sp.entity || sp.action || sp.from || sp.to) && (
          <Link href="/admin/audit" className="text-[12px] text-ik-ink-3 hover:text-brand">Clear</Link>
        )}
      </form>

      <p className="mb-2 text-[11.5px] text-ik-ink-3">
        Showing the latest {rows.length}{rows.length >= 500 ? " (capped — narrow the range or download for the full set)" : ""}.
      </p>

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
