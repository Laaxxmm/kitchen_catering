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
  listHousekeepingIssues,
  listHousekeepingStaff,
  listHousekeepingItems,
  listRooms,
} from "@/server/actions/housekeeping";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function IssuesListPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    room?: string;
    staff?: string;
    item?: string;
  }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const sp = await searchParams;

  const [issues, rooms, staff, items] = await Promise.all([
    listHousekeepingIssues({
      from: sp.from || undefined,
      to: sp.to || undefined,
      roomId: sp.room || undefined,
      staffId: sp.staff || undefined,
      itemId: sp.item || undefined,
      limit: 300,
    }),
    listRooms({ activeOnly: false }),
    listHousekeepingStaff({ activeOnly: false }),
    listHousekeepingItems({ activeOnly: false }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Issues to rooms"
        description="Every trip a housekeeping staff member made to a room with supplies."
        actions={
          <div className="flex gap-2">
            <Link href="/housekeeping/issues/new"><Button>+ New issue</Button></Link>
            <Link href="/housekeeping"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/housekeeping/issues">
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">From</label>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">To</label>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Room</label>
          <select name="room" defaultValue={sp.room ?? ""} className="h-9 min-w-[140px] rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]">
            <option value="">All rooms</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.number}{r.name ? ` — ${r.name}` : ""}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Staff</label>
          <select name="staff" defaultValue={sp.staff ?? ""} className="h-9 min-w-[140px] rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]">
            <option value="">All staff</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Item</label>
          <select name="item" defaultValue={sp.item ?? ""} className="h-9 min-w-[140px] rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]">
            <option value="">All items</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
        {(sp.from || sp.to || sp.room || sp.staff || sp.item) && (
          <Link href="/housekeeping/issues" className="text-[12px] text-ik-ink-3 hover:text-brand">Clear</Link>
        )}
      </form>

      {issues.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No issues match these filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Room</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Recorded by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-[12px]">
                  {formatIST(i.issuedAt, "dd MMM yyyy, HH:mm")}
                </TableCell>
                <TableCell>
                  <span className="font-mono text-[12.5px]">{i.room.number}</span>
                  {i.room.name && (
                    <div className="text-[11px] text-ik-ink-3">{i.room.name}</div>
                  )}
                </TableCell>
                <TableCell className="text-[12.5px]">{i.staff.name}</TableCell>
                <TableCell className="text-[12.5px]">
                  <ul className="grid gap-0.5">
                    {i.lines.map((l) => (
                      <li key={l.id}>
                        {l.item.name} —{" "}
                        <span className="font-mono">
                          {l.quantity.toString()} {l.item.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell className="text-[12px] text-ik-ink-2">
                  {i.purpose ?? "—"}
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
