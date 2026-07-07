import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import {
  createConsolidatedInHouseInvoice,
  listBillableInHouseOrders,
} from "@/server/actions/customer-invoices";
import { formatIST } from "@/lib/time";
import { InHouseBilling } from "./_components/InHouseBilling";

export const dynamic = "force-dynamic";

// Room-service / à-la-carte / management billing — a front-desk-style folio
// screen. Pick the room (or guest), see their served-but-unbilled orders for
// the day, and raise one consolidated GST bill.

export default async function RoomServiceBillingPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.FNB_SERVICE, Role.DELIVERY]);
  const orders = await listBillableInHouseOrders();
  const todayIst = formatIST(new Date(), "yyyy-MM-dd");

  const rows = orders.map((o) => ({
    id: o.id,
    code: o.code,
    channel: o.channel,
    room: o.roomNumber,
    table: o.tableNumber,
    customerId: o.customer.id,
    customerName: o.customer.name,
    istDate: formatIST(o.eventDate, "yyyy-MM-dd"),
    dateLabel: formatIST(o.eventDate, "d MMM, HH:mm"),
    total: o.contractValue.toString(),
    items: o.items.map((it) => ({ name: it.dish.name, portions: it.portions.toString() })),
  }));

  async function generate(orderIds: string[]) {
    "use server";
    const r = await createConsolidatedInHouseInvoice(orderIds);
    if (!r.ok) return r;
    redirect(`/invoices/${r.id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow="Money · In-house"
        title="Room service billing"
        description="Served room-service, à-la-carte and management orders, grouped by room/guest. Pick a date, confirm the items, and raise one consolidated bill."
      />
      <InHouseBilling orders={rows} todayIst={todayIst} onGenerate={generate} />
    </>
  );
}
