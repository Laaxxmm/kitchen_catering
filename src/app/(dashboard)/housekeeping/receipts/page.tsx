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
import { listHousekeepingReceipts } from "@/server/actions/housekeeping";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ReceiptsListPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const receipts = await listHousekeepingReceipts({ limit: 200 });

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Receipts"
        description="Stock received from the maintenance / purchasing team. Each receipt bumps current stock."
        actions={
          <div className="flex gap-2">
            <Link href="/housekeeping/receipts/new"><Button>+ Record receipt</Button></Link>
            <Link href="/housekeeping"><Button variant="outline" size="sm">← Back</Button></Link>
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
                  {r.sourceNote && (
                    <div className="text-[11.5px] text-ik-ink-3">{r.sourceNote}</div>
                  )}
                </TableCell>
                <TableCell className="text-[12.5px]">
                  <ul className="grid gap-0.5">
                    {r.lines.map((l) => (
                      <li key={l.id}>
                        {l.item.name} —{" "}
                        <span className="font-mono">
                          {l.quantity.toString()} {l.item.unit}
                        </span>
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
