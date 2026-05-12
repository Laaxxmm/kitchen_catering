import Link from "next/link";
import { OrderStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listOrders } from "@/server/actions/orders";
import { auth } from "@/server/auth";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

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
  // Only roles that can actually create an order see the New button.
  // KITCHEN_HEAD / STORE_KEEPER / DELIVERY / ACCOUNTS can read orders
  // but creating is SALES / MANAGER / ADMIN.
  const canCreate = role === Role.ADMIN || role === Role.MANAGER || role === Role.SALES;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Orders"
        description="Catering orders. Each goes through store approval, manager approval, requisition, production, delivery, invoice, payment."
        actions={
          canCreate ? (
            <Link href="/orders/new">
              <Button>New order</Button>
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTER_PILLS.map((p) => {
          const active = (sp.filter ?? "all") === p.key;
          return (
            <Link
              key={p.key}
              href={`/orders?filter=${p.key}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
              className={
                "rounded-full px-3 py-1 text-[12px] " +
                (active
                  ? "bg-brand-500 text-white"
                  : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
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
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      {orders.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No orders match.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Meal</TableHead>
              <TableHead className="text-right">Headcount</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <Link href={`/orders/${o.id}`} className="font-mono text-[12px] text-brand hover:underline">
                    {o.code}
                  </Link>
                </TableCell>
                <TableCell>{o.customer.name}</TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(o.eventDate, "yyyy-MM-dd")}</TableCell>
                <TableCell>{o.mealType}</TableCell>
                <TableCell className="text-right">{o.headcount}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(o.contractValue)}</TableCell>
                <TableCell><StatusBadge status={o.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
