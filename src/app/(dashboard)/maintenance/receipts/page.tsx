import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { gateRolePage } from "@/server/rbac";
import { listMaintenanceReceipts } from "@/server/actions/maintenance";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ReceiptsListPage() {
  const session = await gateRolePage([Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER]);
  const receipts = await listMaintenanceReceipts({ limit: 200 });
  // The desk receives against an approved stock request; a bare receipt is
  // management's correction path.
  const canReceiptDirectly = session.user.role !== Role.MAINTENANCE_MANAGER;

  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title="Receipts"
        description="Stock received into the maintenance store — against a stock request, or a manager's correction. Each receipt bumps current stock."
        actions={
          <div className="flex gap-2">
            {canReceiptDirectly ? (
              <Link href="/maintenance/receipts/new"><Button>+ Record receipt</Button></Link>
            ) : (
              <Link href="/maintenance/purchase"><Button>Receive against a stock request</Button></Link>
            )}
            <Link href="/maintenance"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />

      {receipts.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No receipts yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Stock request / bill</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Recorded by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-[12px]">
                  {formatIST(r.receivedAt, "dd MMM yyyy, HH:mm")}
                </TableCell>
                <TableCell>
                  <div className="text-[12.5px]">{r.sourceContact ?? "—"}</div>
                  {r.sourceNote && <div className="text-[11.5px] text-ik-ink-3">{r.sourceNote}</div>}
                </TableCell>
                <TableCell className="text-[12px]">
                  {r.purchaseOrder ? (
                    <span className="font-mono">{r.purchaseOrder.number}</span>
                  ) : (
                    <span className="text-ik-ink-3">Direct</span>
                  )}
                  {r.supplierBillNo && (
                    <div className="text-[11px] text-ik-ink-3">Bill {r.supplierBillNo}</div>
                  )}
                </TableCell>
                <TableCell className="text-[12.5px]">
                  <ul className="grid gap-0.5">
                    {r.lines.map((l) => (
                      <li key={l.id}>
                        {l.item.name}{" "}
                        <span className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                          {l.item.category}
                        </span>
                        {" — "}
                        <span className="font-mono">{l.quantity.toString()} {l.item.unit}</span>
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell className="text-[12.5px]">{r.recordedBy.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
