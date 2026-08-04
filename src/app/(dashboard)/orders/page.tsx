import Link from "next/link";
import { OrderStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrderStatusCounts, listOrders } from "@/server/actions/orders";
import { auth } from "@/server/auth";
import { formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";

export const dynamic = "force-dynamic";

function statusesForFilter(key: string): OrderStatus[] | undefined {
  switch (key) {
    // The clickable KPI tabs map straight onto the order groups.
    case "approval":
      return [
        OrderStatus.PENDING_ADMIN_APPROVAL, OrderStatus.PENDING_STORE_APPROVAL,
        OrderStatus.PENDING_MANAGER_APPROVAL, OrderStatus.PENDING_CHEF_APPROVAL,
        OrderStatus.CHANGES_PROPOSED_BY_CHEF,
      ];
    case "production":
      return [
        OrderStatus.CHEF_APPROVED, OrderStatus.APPROVED,
        OrderStatus.CHEF_REQUISITION_PENDING, OrderStatus.ISSUING, OrderStatus.READY_FOR_PRODUCTION,
        OrderStatus.IN_PREP, OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY,
      ];
    case "payment": return [OrderStatus.DELIVERED, OrderStatus.INVOICED];
    case "done": return [OrderStatus.PAID, OrderStatus.COMPLETED];
    case "other":
      return [
        OrderStatus.DRAFT, OrderStatus.REJECTED_BY_ADMIN, OrderStatus.REJECTED_BY_MANAGER,
        OrderStatus.REJECTED_BY_STORE, OrderStatus.CANCELLED,
      ];
    default: return undefined;
  }
}

type Group = "approval" | "production" | "payment" | "done" | "other";

// Short, human status labels + the group each status lands in. Drives both
// the summary chips and the action-first grouping. Pill tone follows the
// shared language (red = needs you, amber = in progress, green = done).
const STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: "Draft",
  PENDING_ADMIN_APPROVAL: "Manager review",
  PENDING_STORE_APPROVAL: "Store review",
  PENDING_MANAGER_APPROVAL: "Manager review",
  PENDING_CHEF_APPROVAL: "Chef review",
  CHANGES_PROPOSED_BY_CHEF: "Chef changes",
  CHEF_APPROVED: "Chef OK'd",
  APPROVED: "Approved",
  CHEF_REQUISITION_PENDING: "Raising ingredients",
  ISSUING: "Issuing ingredients",
  READY_FOR_PRODUCTION: "Ready to cook",
  IN_PREP: "Cooking",
  READY: "Cooked",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  INVOICED: "Invoiced",
  PAID: "Paid",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED_BY_ADMIN: "Rejected (admin)",
  REJECTED_BY_MANAGER: "Rejected (manager)",
  REJECTED_BY_STORE: "Rejected (store)",
};

function groupOf(status: OrderStatus): Group {
  switch (status) {
    case OrderStatus.PENDING_ADMIN_APPROVAL:
    case OrderStatus.PENDING_STORE_APPROVAL:
    case OrderStatus.PENDING_MANAGER_APPROVAL:
    case OrderStatus.PENDING_CHEF_APPROVAL:
    case OrderStatus.CHANGES_PROPOSED_BY_CHEF:
      return "approval";
    case OrderStatus.CHEF_APPROVED:
    case OrderStatus.APPROVED:
    case OrderStatus.CHEF_REQUISITION_PENDING:
    case OrderStatus.ISSUING:
    case OrderStatus.READY_FOR_PRODUCTION:
    case OrderStatus.IN_PREP:
    case OrderStatus.READY:
    case OrderStatus.OUT_FOR_DELIVERY:
      return "production";
    case OrderStatus.DELIVERED:
    case OrderStatus.INVOICED:
      return "payment";
    case OrderStatus.PAID:
    case OrderStatus.COMPLETED:
      return "done";
    default:
      return "other";
  }
}

const GROUP_TONE: Record<Group, PillTone> = {
  approval: "red",
  production: "amber",
  payment: "grey",
  done: "green",
  other: "grey",
};

const GROUP_ORDER: { key: Group; label: string }[] = [
  { key: "approval", label: "Needs approval" },
  { key: "production", label: "In production" },
  { key: "payment", label: "Awaiting payment" },
  { key: "done", label: "Completed" },
  { key: "other", label: "Drafts & other" },
];

// The clickable KPI tabs at the top of the page. "all" shows the grouped
// overview; each group key filters to that group's flat list.
const TAB_DEFS: { key: string; label: string; group: Group | null; tone?: "red" | "amber" | "green" }[] = [
  { key: "all", label: "All", group: null },
  { key: "approval", label: "Needs approval", group: "approval", tone: "red" },
  { key: "production", label: "In production", group: "production", tone: "amber" },
  { key: "payment", label: "Awaiting payment", group: "payment" },
  { key: "done", label: "Completed", group: "done", tone: "green" },
  { key: "other", label: "Drafts & other", group: "other" },
];

type OrderRow = Awaited<ReturnType<typeof listOrders>>[number];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const filter = sp.filter ?? "all";
  const myQueue = filter === "mine";
  const statuses = myQueue ? undefined : statusesForFilter(filter);
  const [session, orders, statusCounts] = await Promise.all([
    auth(),
    listOrders({ myQueue, status: statuses, query: sp.q }),
    getOrderStatusCounts(),
  ]);
  const role = session?.user?.role;
  const canCreate = role === Role.ADMIN || role === Role.MANAGER || role === Role.SALES || role === Role.FNB_SERVICE || role === Role.DELIVERY;
  // F&B Service takes in-house room orders but shouldn't see the financials.
  const isFnb = role === Role.DELIVERY || role === Role.FNB_SERVICE;
  const isAll = filter === "all" && !sp.q;

  // Group counts across ALL orders (not just the filtered view) so the tabs
  // stay accurate whichever one is selected.
  const counts = { approval: 0, production: 0, payment: 0, done: 0, other: 0 } as Record<Group, number>;
  for (const [st, n] of Object.entries(statusCounts)) counts[groupOf(st as OrderStatus)] += n ?? 0;
  const totalCount = Object.values(statusCounts).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Orders"
        description="What needs you is on top; running and finished orders are grouped below."
        actions={
          <div className="flex flex-wrap gap-2">
            {(role === Role.ADMIN || role === Role.MANAGER || role === Role.SALES) && (
              <a href="/api/export/orders"><Button variant="outline">Download Excel</Button></a>
            )}
            {(role === Role.ADMIN || role === Role.MANAGER) && (
              <Link href="/orders/templates"><Button variant="outline">Recurring orders</Button></Link>
            )}
            {canCreate && <Link href="/orders/new"><Button>New order</Button></Link>}
          </div>
        }
      />

      {/* Clickable KPI tabs — switch the view by status group. Counts are
          whole-table totals; the active tab is highlighted. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {TAB_DEFS.map((t) => {
          const active = filter === t.key;
          const count = t.group ? counts[t.group] : totalCount;
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
              href={`/orders?filter=${t.key}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
              className={
                "rounded-[12px] border p-3 transition " +
                (active
                  ? "border-brand-500 bg-brand-50"
                  : "border-ik-rule bg-ik-card hover:border-brand-200")
              }
            >
              <div className={"font-mono text-[20px] leading-none " + dotTone}>{count}</div>
              <div className="mt-1 text-[11.5px] text-ik-ink-2">{t.label}</div>
            </Link>
          );
        })}
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/orders">
        <input type="hidden" name="filter" value={filter} />
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search by code or customer…"
          className="h-9 w-72 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <Button type="submit" variant="outline" size="sm">Search</Button>
        <Link
          href="/orders?filter=mine"
          className={
            "ml-1 rounded-full px-3 py-1 text-[12px] " +
            (myQueue ? "bg-brand-500 text-white" : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
          }
        >
          My queue
        </Link>
      </form>

      {orders.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No orders match.</p>
      ) : isAll ? (
        <div className="grid gap-5">
          {GROUP_ORDER.map(({ key, label }) => {
            const rows = orders.filter((o) => groupOf(o.status) === key);
            if (rows.length === 0) return null;
            return (
              <section key={key}>
                <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{label} · {rows.length}</h2>
                <OrdersTable rows={rows} showValue={!isFnb} />
              </section>
            );
          })}
        </div>
      ) : (
        <OrdersTable rows={orders} showValue={!isFnb} />
      )}
    </>
  );
}

function OrdersTable({ rows, showValue = true }: { rows: OrderRow[]; showValue?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Customer</TableHead>
          <TableHead>Meal</TableHead>
          <TableHead className="text-right">Pax</TableHead>
          <TableHead>Event</TableHead>
          {showValue && <TableHead className="text-right">Value</TableHead>}
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((o) => {
          const tone = o.status === OrderStatus.CANCELLED || o.status.startsWith("REJECTED")
            ? "grey"
            : GROUP_TONE[groupOf(o.status)];
          return (
            <TableRow key={o.id}>
              <TableCell>
                <Link href={`/orders/${o.id}`} className="text-ik-ink hover:text-brand hover:underline">
                  <strong>{o.customer.name}</strong>
                </Link>
                <span className="ml-2 font-mono text-[11px] text-ik-ink-3">{o.code}</span>
              </TableCell>
              <TableCell className="text-[12.5px] text-ik-ink-2">{o.mealType}</TableCell>
              <TableCell className="text-right">{o.headcount}</TableCell>
              <TableCell className="font-mono text-[12px]">
                {formatIST(o.eventDate, "yyyy-MM-dd")}
                <div className="text-[10.5px] text-ik-ink-3">
                  {formatIST(o.deliveryWindowStart, "HH:mm")}–{formatIST(o.deliveryWindowEnd, "HH:mm")}
                </div>
              </TableCell>
              {showValue && <TableCell className="text-right font-mono">{formatINRWhole(o.contractValue)}</TableCell>}
              <TableCell><StatusPill tone={tone}>{STATUS_LABEL[o.status]}</StatusPill></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
