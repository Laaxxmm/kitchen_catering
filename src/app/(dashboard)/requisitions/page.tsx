import Link from "next/link";
import { ChefRequisitionStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listChefRequisitions } from "@/server/actions/chef-requisitions";
import { formatIST } from "@/lib/time";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";

export const dynamic = "force-dynamic";

type Group = "issue" | "done" | "other";

const STATUS_META: Record<ChefRequisitionStatus, { group: Group; label: string; tone: PillTone }> = {
  DRAFT: { group: "other", label: "Draft", tone: "grey" },
  SUBMITTED: { group: "issue", label: "Needs issuing", tone: "amber" },
  PARTIALLY_ISSUED: { group: "issue", label: "Part issued", tone: "amber" },
  FULLY_ISSUED: { group: "done", label: "Fully issued", tone: "green" },
  CANCELLED: { group: "other", label: "Cancelled", tone: "grey" },
};

// The clickable KPI tabs. "all" shows the grouped overview; each group key
// filters to that group's flat list.
const TAB_DEFS: { key: string; label: string; group: Group | null; tone?: "red" | "amber" | "green" }[] = [
  { key: "all", label: "All", group: null },
  { key: "issue", label: "Needs issuing", group: "issue", tone: "red" },
  { key: "done", label: "Fully issued", group: "done", tone: "green" },
  { key: "other", label: "Draft & cancelled", group: "other" },
];

const GROUP_ORDER: { key: Group; label: string }[] = [
  { key: "issue", label: "Needs issuing" },
  { key: "done", label: "Fully issued" },
  { key: "other", label: "Draft & cancelled" },
];

type Req = Awaited<ReturnType<typeof listChefRequisitions>>[number];

/** How soon the event is, from now — drives the urgency flag on open reqs. */
function eventUrgency(eventDate: Date, now: Date): "overdue" | "today" | "soon" | null {
  const ms = eventDate.getTime() - now.getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  if (ms < 0) return "overdue";
  if (eventDate < tomorrowStart) return "today";
  if (ms <= 48 * 60 * 60 * 1000) return "soon";
  return null;
}

export default async function RequisitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const sp = await searchParams;
  const filter = sp.filter ?? "all";
  const [session, requisitions] = await Promise.all([auth(), listChefRequisitions()]);
  const role = session?.user?.role;
  const canRaise = role === Role.ADMIN || role === Role.KITCHEN_HEAD;
  const now = new Date();

  const counts: Record<Group, number> = { issue: 0, done: 0, other: 0 };
  for (const r of requisitions) counts[STATUS_META[r.status].group] += 1;

  // Urgency: open requisitions whose event is today or already overdue — the
  // store needs to issue these first. Drives the red dot on the "Needs
  // issuing" tab even when the plain count would read as routine amber.
  const urgentCount = requisitions.filter(
    (r) => STATUS_META[r.status].group === "issue" && r.order != null && ["overdue", "today"].includes(eventUrgency(r.order.eventDate, now) ?? ""),
  ).length;

  const isAll = filter === "all";
  const activeGroup = TAB_DEFS.find((t) => t.key === filter)?.group ?? null;
  const visible = activeGroup ? requisitions.filter((r) => STATUS_META[r.status].group === activeGroup) : requisitions;

  return (
    <>
      <PageHeader
        eyebrow="Make & deliver"
        title="Requisitions"
        description="Kitchen → store. What needs issuing — soonest events first — is up top."
        actions={canRaise ? <Link href="/requisitions/new"><Button>New stock request</Button></Link> : null}
      />

      {/* Clickable KPI tabs — switch the view by status group. The "Needs
          issuing" tab turns red the moment anything is open, and shows an
          urgency note when an event is today or overdue. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TAB_DEFS.map((t) => {
          const active = filter === t.key;
          const count = t.group ? counts[t.group] : requisitions.length;
          const showUrgent = t.key === "issue" && urgentCount > 0;
          const dotTone =
            t.tone === "red" && count > 0
              ? "text-alert"
              : t.tone === "amber" && count > 0
                ? "text-amber"
                : t.tone === "green"
                  ? "text-positive"
                  : "text-ik-ink";
          return (
            <Link
              key={t.key}
              href={`/requisitions?filter=${t.key}`}
              className={
                "rounded-[12px] border p-3 transition " +
                (active ? "border-brand-500 bg-brand-50" : "border-ik-rule bg-ik-card hover:border-brand-200")
              }
            >
              <div className={"font-mono text-[20px] leading-none " + dotTone}>{count}</div>
              <div className="mt-1 text-[11.5px] text-ik-ink-2">{t.label}</div>
              {showUrgent && (
                <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-alert-wash px-1.5 py-0.5 text-[10px] font-medium text-alert">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-alert" /> {urgentCount} due now
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {requisitions.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No requisitions yet.</p>
      ) : isAll ? (
        <div className="grid gap-5">
          {GROUP_ORDER.map(({ key, label }) => {
            const rows = requisitions.filter((r) => STATUS_META[r.status].group === key);
            if (rows.length === 0) return null;
            return <ReqSection key={key} title={label} rows={rows} now={now} />;
          })}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">Nothing here right now.</p>
      ) : (
        <ReqSection rows={visible} now={now} />
      )}
    </>
  );
}

function ReqSection({ title, rows, now }: { title?: string; rows: Req[]; now: Date }) {
  return (
    <section>
      {title && <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{title} · {rows.length}</h2>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Req no</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Event</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const meta = STATUS_META[r.status];
            const urgency = meta.group === "issue" && r.order ? eventUrgency(r.order.eventDate, now) : null;
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/requisitions/${r.id}`} className="font-mono text-brand hover:underline">{r.requisitionNo}</Link>
                </TableCell>
                <TableCell>
                  {r.order ? (
                    <Link href={`/orders/${r.orderId}`} className="font-mono text-[12px] text-brand hover:underline">{r.order.code}</Link>
                  ) : (
                    <span className="text-[12px] text-ik-ink-3">General request</span>
                  )}
                </TableCell>
                <TableCell>{r.order?.customer.name ?? <span className="text-ik-ink-3">Kitchen stock</span>}</TableCell>
                <TableCell className="font-mono text-[12px]">
                  {r.order ? formatIST(r.order.eventDate, "yyyy-MM-dd") : <span className="text-ik-ink-3">—</span>}
                  {urgency === "overdue" && <span className="ml-2 rounded bg-alert-wash px-1.5 py-0.5 font-sans text-[10px] font-medium text-alert">Overdue</span>}
                  {urgency === "today" && <span className="ml-2 rounded bg-alert-wash px-1.5 py-0.5 font-sans text-[10px] font-medium text-alert">Today</span>}
                  {urgency === "soon" && <span className="ml-2 rounded bg-amber-wash px-1.5 py-0.5 font-sans text-[10px] font-medium text-amber">Soon</span>}
                </TableCell>
                <TableCell className="text-right">{r._count.lines}</TableCell>
                <TableCell><StatusPill tone={meta.tone}>{meta.label}</StatusPill></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
