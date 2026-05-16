import Link from "next/link";
import { MaintenanceActivityStatus, MaintenanceCategory, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
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
  listMaintenanceActivities,
  listMaintenanceItems,
  listMaintenanceStaff,
} from "@/server/actions/maintenance";
import { listRooms } from "@/server/actions/housekeeping";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

const CAT_LABEL: Record<MaintenanceCategory, string> = {
  ELECTRICAL: "Electrical",
  MECHANICAL: "Mechanical",
  GENERAL: "General",
};

export default async function ActivitiesListPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    room?: string;
    staff?: string;
    item?: string;
    category?: string;
    status?: string;
  }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER]);
  const sp = await searchParams;

  const cat = sp.category && (Object.values(MaintenanceCategory) as string[]).includes(sp.category)
    ? (sp.category as MaintenanceCategory)
    : undefined;
  const stat = sp.status && (Object.values(MaintenanceActivityStatus) as string[]).includes(sp.status)
    ? (sp.status as MaintenanceActivityStatus)
    : undefined;

  const [activities, rooms, staff, items] = await Promise.all([
    listMaintenanceActivities({
      from: sp.from || undefined,
      to: sp.to || undefined,
      roomId: sp.room || undefined,
      staffId: sp.staff || undefined,
      itemId: sp.item || undefined,
      category: cat,
      status: stat,
      limit: 300,
    }),
    listRooms({ activeOnly: false }),
    listMaintenanceStaff({ activeOnly: false }),
    listMaintenanceItems({ activeOnly: false }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title="Activities"
        description="Every recorded work visit — what was reported, what was done, which spares were consumed."
        actions={
          <div className="flex gap-2">
            <Link href="/maintenance/activities/new"><Button>+ Log activity</Button></Link>
            <Link href="/maintenance"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/maintenance/activities">
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">From</label>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">To</label>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Category</label>
          <select name="category" defaultValue={sp.category ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]">
            <option value="">All</option>
            {Object.values(MaintenanceCategory).map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Status</label>
          <select name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]">
            <option value="">All</option>
            {Object.values(MaintenanceActivityStatus).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
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
        {(sp.from || sp.to || sp.room || sp.staff || sp.item || sp.category || sp.status) && (
          <Link href="/maintenance/activities" className="text-[12px] text-ik-ink-3 hover:text-brand">Clear</Link>
        )}
      </form>

      {activities.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No activities match these filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Room</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Issue / work</TableHead>
              <TableHead>Items used</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-[12px]">
                  {formatIST(a.performedAt, "dd MMM yyyy, HH:mm")}
                </TableCell>
                <TableCell>
                  <span className="font-mono text-[12.5px]">{a.room.number}</span>
                  {a.room.name && <div className="text-[11px] text-ik-ink-3">{a.room.name}</div>}
                </TableCell>
                <TableCell className="text-[12.5px]">
                  {a.staff.name}
                  <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                    {CAT_LABEL[a.staff.category]}
                  </div>
                </TableCell>
                <TableCell className="text-[11.5px] uppercase tracking-wide text-ik-ink-2">
                  {CAT_LABEL[a.category]}
                </TableCell>
                <TableCell className="text-[12.5px]">
                  <div className="font-medium">{a.issueReported}</div>
                  {a.workDone && (
                    <div className="mt-0.5 text-[11.5px] text-ik-ink-3">→ {a.workDone}</div>
                  )}
                </TableCell>
                <TableCell className="text-[12px]">
                  {a.lines.length === 0 ? (
                    <span className="text-ik-ink-3">—</span>
                  ) : (
                    <ul className="grid gap-0.5">
                      {a.lines.map((l) => (
                        <li key={l.id}>
                          {l.item.name} — <span className="font-mono">{l.quantity.toString()} {l.item.unit}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell><StatusBadge status={a.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
