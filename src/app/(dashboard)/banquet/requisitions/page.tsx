import Link from "next/link";
import { BanquetRequisitionStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { gateRolePage } from "@/server/rbac";
import { listBanquetRequisitions } from "@/server/actions/banquet";
import { formatIST } from "@/lib/time";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";

export const dynamic = "force-dynamic";

type Group = "issue" | "done" | "other";

const STATUS_META: Record<BanquetRequisitionStatus, { group: Group; label: string; tone: PillTone }> = {
  SUBMITTED: { group: "issue", label: "Needs issuing", tone: "amber" },
  PARTIALLY_ISSUED: { group: "issue", label: "Part issued", tone: "amber" },
  FULLY_ISSUED: { group: "done", label: "Fully issued", tone: "green" },
  CANCELLED: { group: "other", label: "Cancelled", tone: "grey" },
};

const GROUP_ORDER: { key: Group; label: string }[] = [
  { key: "issue", label: "Needs issuing" },
  { key: "done", label: "Fully issued" },
  { key: "other", label: "Cancelled" },
];

type Req = Awaited<ReturnType<typeof listBanquetRequisitions>>[number];

export default async function BanquetRequisitionsPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER]);
  const requisitions = await listBanquetRequisitions();

  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Requisitions"
        description="F&B → store. What needs issuing is up top — issue full / partial, or raise a PO for anything short."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/banquet"><Button variant="outline">← Store</Button></Link>
            <Link href="/banquet/request"><Button>New requisition</Button></Link>
          </div>
        }
      />

      {requisitions.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No requisitions yet.</p>
      ) : (
        <div className="grid gap-5">
          {GROUP_ORDER.map(({ key, label }) => {
            const rows = requisitions.filter((r) => STATUS_META[r.status].group === key);
            if (rows.length === 0) return null;
            return <ReqSection key={key} title={label} rows={rows} />;
          })}
        </div>
      )}
    </>
  );
}

function ReqSection({ title, rows }: { title: string; rows: Req[] }) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{title} · {rows.length}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Req no</TableHead>
            <TableHead>Requested by</TableHead>
            <TableHead>Event</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead>Raised</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/banquet/requisitions/${r.id}`} className="font-mono text-brand hover:underline">{r.requisitionNo}</Link>
                </TableCell>
                <TableCell>{r.createdBy?.name ?? "—"}</TableCell>
                <TableCell>
                  {r.order ? (
                    <span className="font-mono text-[12px]">{r.order.code} · {r.order.customer.name}</span>
                  ) : (
                    <span className="text-[12px] text-ik-ink-3">No order</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{r._count.lines}</TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(r.submittedAt, "yyyy-MM-dd")}</TableCell>
                <TableCell><StatusPill tone={meta.tone}>{meta.label}</StatusPill></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
