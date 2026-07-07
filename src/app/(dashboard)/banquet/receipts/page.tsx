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
import { listBanquetReceipts } from "@/server/actions/banquet";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function BanquetReceiptsListPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER]);
  const receipts = await listBanquetReceipts({ limit: 200 });

  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Receipts"
        description="Stock IN — purchased / handed over to the F&B store."
        actions={
          <div className="flex gap-2">
            <Link href="/banquet/receipts/new"><Button>+ Record receipt</Button></Link>
            <Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>
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
                  {r.sourceNote && <div className="text-[11.5px] text-ik-ink-3">{r.sourceNote}</div>}
                </TableCell>
                <TableCell className="text-[12.5px]">
                  <ul className="grid gap-0.5">
                    {r.lines.map((l) => (
                      <li key={l.id}>
                        {l.item.name}
                        {l.item.category && (
                          <span className="ml-1 text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                            {l.item.category}
                          </span>
                        )}
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
