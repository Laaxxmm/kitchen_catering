import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { getGRN } from "@/server/actions/procurement";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

// Recording the supplier bill is a finance-desk job. Store keepers (and
// everyone else) just see the stock-updated confirmation.
const BILL_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];

export default async function GRNDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [grn, session] = await Promise.all([getGRN(id), auth()]);
  if (!grn) notFound();
  const canRecordBill = BILL_ROLES.includes(session?.user?.role as Role);
  return (
    <>
      <PageHeader
        eyebrow={`GRN · PO ${grn.po.poNo}`}
        title={grn.grnNo}
        description={`${grn.po.vendor.name} · received ${formatIST(grn.receivedAt, "yyyy-MM-dd HH:mm")}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/procurement/purchase-orders/${grn.poId}`}><Button variant="outline">View PO</Button></Link>
            <Link href="/procurement/grns"><Button variant="outline">Back</Button></Link>
          </div>
        }
      />
      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <StatusBadge status={grn.status} />
        {grn.receivedBy?.name && <span className="text-ik-ink-3">Received by {grn.receivedBy.name}</span>}
      </div>

      <div className="mb-4 rounded-md border border-brand-200 bg-brand-50 p-3 text-[13px] text-ik-ink-2">
        {canRecordBill ? (
          <>
            <strong>Next:</strong> Stock and average cost have been updated automatically. When the vendor
            sends their bill, record it on the Supplier bills page — the system will match it against this GRN
            and the PO before allowing payment.
            <div className="mt-2">
              <Link href={`/procurement/vendor-bills/new?poId=${grn.poId}`}>
                <Button size="sm" variant="outline">Record supplier bill</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <strong>Done:</strong> Stock and average cost have been updated automatically. Nothing more is
            needed from the store — the finance desk handles the supplier bill and payment.
          </>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Ordered</TableHead>
            <TableHead className="text-right">Accepted</TableHead>
            <TableHead className="text-right">Rejected</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grn.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>{l.poLine.ingredient?.name ?? l.poLine.description ?? "—"}</TableCell>
              <TableCell className="text-right font-mono">{l.orderedQty.toString()}</TableCell>
              <TableCell className="text-right font-mono text-positive">{l.acceptedQty.toString()}</TableCell>
              <TableCell className="text-right font-mono text-alert">{l.rejectedQty.toString()}</TableCell>
              <TableCell className="text-ik-ink-2 text-[11.5px]">{l.reason ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {grn.notes && <p className="mt-3 text-[12.5px] text-ik-ink-2">{grn.notes}</p>}
    </>
  );
}
