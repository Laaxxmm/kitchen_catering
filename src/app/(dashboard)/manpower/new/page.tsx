import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { db } from "@/server/db";
import { listOrders } from "@/server/actions/orders";
import { formatIST } from "@/lib/time";
import { RAISE_ROLES } from "../_components/gates";
import { ManpowerForm } from "./_components/ManpowerForm";

export const dynamic = "force-dynamic";

export default async function NewManpowerRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  await gateRolePage(RAISE_ROLES);
  const sp = await searchParams;
  const orders = await listOrders({});

  // Arriving from an order older than the 200 listOrders returns (or outside
  // this role's channel scope) — pull that one in so the tag survives.
  const missing =
    sp.orderId && !orders.some((o) => o.id === sp.orderId)
      ? await db.order.findUnique({
          where: { id: sp.orderId },
          select: { id: true, code: true, eventDate: true, customer: { select: { name: true } } },
        })
      : null;

  const options = [...(missing ? [missing] : []), ...orders].map((o) => ({
    id: o.id,
    label: `${o.code} · ${o.customer.name} · ${formatIST(o.eventDate, "d MMM yyyy")}`,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Manpower"
        title="Request manpower"
        description="Hired-in casual labour: how many, for what work, for how many days, and roughly what it costs. A manager approves before it counts."
        actions={<Link href="/manpower"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      <ManpowerForm orders={options} defaultOrderId={sp.orderId ?? ""} />
    </>
  );
}
