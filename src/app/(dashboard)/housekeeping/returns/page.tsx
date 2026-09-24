import Link from "next/link";
import { Role, StoreAdjustmentKind } from "@prisma/client";
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
import { listHousekeepingAdjustments } from "@/server/actions/housekeeping";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<StoreAdjustmentKind, string> = {
  RETURNED: "Returned",
  LOST: "Lost / damaged",
  ADJUSTED: "Adjusted by hand",
  RESTORED: "Restored",
};

/** "+12" / "−3" / "0" — a signed delta, or a dash when nothing moved. */
function signed(v: string) {
  const n = Number(v);
  if (n === 0) return <span className="text-ik-ink-3">—</span>;
  return <span className={n > 0 ? "text-positive" : "text-alert"}>{n > 0 ? `+${v}` : v}</span>;
}

export default async function HousekeepingReturnsListPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const sp = await searchParams;
  const rows = await listHousekeepingAdjustments({
    from: sp.from || undefined,
    to: sp.to || undefined,
    limit: 300,
  });

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping · Reusables"
        title="Returns & adjustments"
        description="Linen back from rooms, write-offs, and hand corrections — every stock change that isn't a receipt or an issue."
        actions={
          <div className="flex gap-2">
            <Link href="/housekeeping/returns/new"><Button>+ Return linen</Button></Link>
            <Link href="/housekeeping"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/housekeeping/returns">
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">From</label>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">To</label>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
        {(sp.from || sp.to) && (
          <Link href="/housekeeping/returns" className="text-[12px] text-ik-ink-3 hover:text-brand">Clear</Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">Nothing recorded in this range.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Clean stock</TableHead>
              <TableHead className="text-right">Out in use</TableHead>
              <TableHead>Room</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Reason / note</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-[12px]">
                  {formatIST(r.at, "dd MMM yyyy, HH:mm")}
                </TableCell>
                <TableCell className="text-[12.5px]">{KIND_LABEL[r.kind]}</TableCell>
                <TableCell className="text-[12.5px]">
                  {r.item.name} <span className="text-ik-ink-3">{r.item.unit}</span>
                </TableCell>
                <TableCell className="text-right font-mono text-[12.5px]">
                  {signed(r.delta)}
                  <div className="text-[10.5px] text-ik-ink-3">{r.beforeQty} → {r.afterQty}</div>
                </TableCell>
                <TableCell className="text-right font-mono text-[12.5px]">{signed(r.circulationDelta)}</TableCell>
                <TableCell className="text-[12.5px]">
                  {r.room ? (
                    <>
                      <span className="font-mono">{r.room.number}</span>
                      {r.room.name && <div className="text-[11px] text-ik-ink-3">{r.room.name}</div>}
                    </>
                  ) : (
                    <span className="text-ik-ink-3">—</span>
                  )}
                </TableCell>
                <TableCell className="text-[12.5px]">{r.staff?.name ?? <span className="text-ik-ink-3">—</span>}</TableCell>
                <TableCell className="text-[12px] text-ik-ink-2">
                  {r.reason}
                  {r.note && <div className="text-[11px] text-ik-ink-3">{r.note}</div>}
                </TableCell>
                <TableCell className="text-[12.5px]">{r.by.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
