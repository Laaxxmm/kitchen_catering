import Link from "next/link";
import { OrderStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listOrders } from "@/server/actions/orders";
import { auth } from "@/server/auth";
import { formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";

export const dynamic = "force-dynamic";

const FILTER_PILLS = [
  { key: "all", label: "All" },
  { key: "mine", label: "My queue" },
  { key: "draft", label: "Draft" },
  { key: "pending", label: "Pending approval" },
  { key: "active", label: "Active" },
  { key: "rejected", label: "Rejected" },
  { key: "completed", label: "Completed" },
] as const;

function statusesForFilter(key: string): OrderStatus[] | undefined {
  switch (key) {
    case "draft": return [OrderStatus.DRAFT];
    case "pending":
      return [OrderStatus.PENDING_STORE_APPROVAL, OrderStatus.PENDING_MANAGER_APPROVAL, OrderStatus.REJECTED_BY_STORE];
    case "active":
      return [
        OrderStatus.CHEF_REQUISITION_PENDING, OrderStatus.ISSUING, OrderStatus.READY_FOR_PRODUCTION,
        OrderStatus.IN_PREP, OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, OrderStatus.INVOICED,
      ];
    case "rejected": return [OrderStatus.REJECTED_BY_MANAGER, OrderStatus.CANCELLED];
    case "completed": return [OrderStatus.PAID, OrderStatus.COMPLETED];
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
  const [session, orders] = await Promise.all([
    auth(),
    listOrders({ myQueue, status: statuses, query: sp.q }),
  ]);
  const role = session?.user?.role;
  const canCreate = role === Role.ADMIN || role === Role.MANAGER || role === Role.SALES;
  const isAll = filter === "all" && !sp.q;

  const counts = { approval: 0, production: 0, payment: 0, done: 0, other: 0 } as Record<Group, number>;
  for (const o of orders) counts[groupOf(o.status)] += 1;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Orders"
        description="What needs you is on top; running and finished orders are grouped below."
        actions={canCreate ? <Link href="/orders/new"><Button>New order</Button></Link> : null}
      />

      <div className="mb-4">
        <SummaryStrip
          chips={[
            { label: "Needs approval", value: counts.approval, tone: counts.approval > 0 ? "red" : "grey" },
            { label: "In production", value: counts.production, tone: counts.production > 0 ? "amber" : "grey" },
            { label: "Awaiting payment", value: counts.payment, tone: "grey" },
            { label: "Completed", value: counts.done, tone: "green" },
          ]}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTER_PILLS.map((p) => {
          const active = (sp.filter ?? "all") === p.key;
          return (
            <Link
              key={p.key}
              href={`/orders?filter=${p.key}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
              className={
                "rounded-full px-3 py-1 text-[12px] " +
                (active ? "bg-brand-500 text-white" : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
              }
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/orders">
        <input type="hidden" name="filter" value={filter} />
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search by code or customer…"
          className="h-9 w-72 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <Button type="submit" variant="outline" size="sm">Search</Button>
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
                <OrdersTable rows={rows} />
              </section>
            );
          })}
        </div>
      ) : (
        <OrdersTable rows={orders} />
      )}
    </>
  );
}

function OrdersTable({ rows }: { rows: OrderRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Customer</TableHead>
          <TableHead>Meal</TableHead>
          <TableHead className="text-right">Pax</TableHead>
          <TableHead>Event</TableHead>
          <TableHead className="text-right">Value</TableHead>
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
              <TableCell className="font-mono text-[12px]">{formatIST(o.eventDate, "yyyy-MM-dd")}</TableCell>
              <TableCell className="text-right font-mono">{formatINRWhole(o.contractValue)}</TableCell>
              <TableCell><StatusPill tone={tone}>{STATUS_LABEL[o.status]}</StatusPill></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
