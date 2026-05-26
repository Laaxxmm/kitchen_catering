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
import {
  listBanquetIssues,
  listBanquetItems,
} from "@/server/actions/banquet";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function BanquetIssuesListPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; item?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE]);
  const sp = await searchParams;

  const [issues, items] = await Promise.all([
    listBanquetIssues({
      from: sp.from || undefined,
      to: sp.to || undefined,
      itemId: sp.item || undefined,
      limit: 300,
    }),
    listBanquetItems({ activeOnly: false }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Issues"
        description="Stock OUT — items issued from the banquet store to events, room service, or housekeeping."
        actions={
          <div className="flex gap-2">
            <Link href="/banquet/issues/new"><Button>+ New issue</Button></Link>
            <Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/banquet/issues">
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">From</label>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">To</label>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Item</label>
          <select name="item" defaultValue={sp.item ?? ""} className="h-9 min-w-[180px] rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]">
            <option value="">All items</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
        {(sp.from || sp.to || sp.item) && (
          <Link href="/banquet/issues" className="text-[12px] text-ik-ink-3 hover:text-brand">Clear</Link>
        )}
      </form>

      {issues.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No issues match these filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Items issued</TableHead>
              <TableHead>Recorded by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-[12px]">
                  {formatIST(i.issuedAt, "dd MMM yyyy, HH:mm")}
                </TableCell>
                <TableCell className="text-[12.5px]">
                  <div className="font-medium">{i.purpose}</div>
                  {i.notes && <div className="mt-0.5 text-[11.5px] text-ik-ink-3">{i.notes}</div>}
                </TableCell>
                <TableCell>
                  {i.order ? (
                    <Link href={`/orders/${i.order.id}`} className="font-mono text-[12px] text-brand hover:underline">
                      {i.order.code}
                    </Link>
                  ) : (
                    <span className="text-ik-ink-3">—</span>
                  )}
                </TableCell>
                <TableCell className="text-[12.5px]">
                  <ul className="grid gap-0.5">
                    {i.lines.map((l) => (
                      <li key={l.id}>
                        {l.item.name} — <span className="font-mono">{l.quantity.toString()} {l.item.unit}</span>
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell className="text-[12.5px]">{i.recordedBy.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
