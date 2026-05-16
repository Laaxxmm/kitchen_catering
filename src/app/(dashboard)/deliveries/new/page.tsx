import { OrderStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { listOrders } from "@/server/actions/orders";
import { listDrivers, scheduleDelivery } from "@/server/actions/deliveries";
import { ScheduleDeliveryForm } from "../_components/ScheduleDeliveryForm";

export const dynamic = "force-dynamic";

export default async function NewDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;
  const [orders, drivers] = await Promise.all([
    listOrders({ status: [OrderStatus.READY] }),
    listDrivers(),
  ]);

  async function submit(input: { orderId: string; driverUserId: string; vehicleNo: string | null; scheduledAt: string }) {
    "use server";
    return scheduleDelivery(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations · Deliveries"
        title="Schedule delivery"
        description="Pick the order, pick a driver, set the time. The driver confirms delivery from their phone when the goods are handed over — the tax invoice is auto-generated and emailed to the customer at that moment."
      />
      <ScheduleDeliveryForm
        orders={orders.map((o) => ({ id: o.id, code: o.code, customerName: o.customer.name, eventDate: o.eventDate.toISOString() }))}
        drivers={drivers}
        onSubmit={submit}
        initialOrderId={orderId ?? null}
      />
    </>
  );
}
