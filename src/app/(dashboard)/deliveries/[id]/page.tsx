import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveryStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { auth } from "@/server/auth";
import {
  confirmDeliveryOTP,
  dispatchDelivery,
  failDelivery,
  getDelivery,
  markDeliveryArrived,
} from "@/server/actions/deliveries";
import { formatIST } from "@/lib/time";
import { DeliveryControls } from "./_components/DeliveryControls";

export const dynamic = "force-dynamic";

export default async function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [delivery, session] = await Promise.all([getDelivery(id), auth()]);
  if (!delivery) notFound();

  const role = session?.user?.role;
  const isDriver = role === Role.DELIVERY;
  const isAdmin = role === Role.ADMIN;
  const isManager = role === Role.MANAGER || isAdmin;
  const isAssignedDriver = isDriver && delivery.driverUserId === session?.user?.id;
  const canAct = isAdmin || isManager || isAssignedDriver;

  async function doDispatch() {
    "use server";
    return dispatchDelivery(id);
  }
  async function doArrived() {
    "use server";
    return markDeliveryArrived(id);
  }
  async function doOTP() {
    "use server";
    // OTP step retired — confirmation is a single click. Pass an empty
    // payload; the server treats absent OTP as "no readback required".
    return confirmDeliveryOTP(id, {});
  }
  async function doFail(reason: string) {
    "use server";
    return failDelivery(id, { reason });
  }

  return (
    <>
      <PageHeader
        eyebrow={`Delivery · Order ${delivery.order.code}`}
        title={delivery.deliveryNo}
        description={`Scheduled ${formatIST(delivery.scheduledAt, "yyyy-MM-dd HH:mm")} · ${delivery.order.customer.name}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/orders/${delivery.order.id}`}><Button variant="outline">View order</Button></Link>
            <Link href="/deliveries"><Button variant="outline">Back</Button></Link>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <section className="md:col-span-2 grid gap-4">
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium text-[14px] text-ik-ink">Status</h3>
              <StatusBadge status={delivery.status} />
            </div>
            <ol className="grid gap-1 text-[12.5px]">
              <li><span className="text-ik-ink-3">Scheduled:</span> <span className="font-mono">{formatIST(delivery.scheduledAt)}</span></li>
              {delivery.dispatchedAt && <li><span className="text-ik-ink-3">Dispatched:</span> <span className="font-mono">{formatIST(delivery.dispatchedAt)}</span></li>}
              {delivery.arrivedAt && <li><span className="text-ik-ink-3">Arrived:</span> <span className="font-mono">{formatIST(delivery.arrivedAt)}</span></li>}
              {delivery.deliveredAt && <li><span className="text-ik-ink-3">Delivered:</span> <span className="font-mono">{formatIST(delivery.deliveredAt)}</span></li>}
              {delivery.failureReason && <li className="text-alert">Failure: {delivery.failureReason}</li>}
              {/* Legacy OTP-attempt counter (pre-retirement deliveries only). */}
              {delivery.otpAttempts > 0 && (
                <li className="text-amber">Failed verification attempts: {delivery.otpAttempts}/3</li>
              )}
            </ol>
          </div>

          {canAct && delivery.status !== DeliveryStatus.DELIVERED && delivery.status !== DeliveryStatus.FAILED && (
            <div className="rounded-md border border-brand-200 bg-brand-50 p-4">
              <h3 className="mb-3 font-medium text-[14px] text-brand-700">Driver actions</h3>
              <DeliveryControls
                status={delivery.status}
                onDispatch={doDispatch}
                onArrived={doArrived}
                onConfirmOTP={doOTP}
                onFail={doFail}
              />
            </div>
          )}

          {/* Full order details — what's being delivered, for how many, when. */}
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-[14px] text-ik-ink">Order {delivery.order.code}</h3>
              <span className="text-[12px] text-ik-ink-2">
                {delivery.order.channel} · {delivery.order.mealType} · {delivery.order.headcount} pax
              </span>
            </div>
            <div className="mb-3 grid gap-1 text-[12.5px] text-ik-ink-2">
              <div>
                <span className="text-ik-ink-3">Event:</span>{" "}
                <span className="font-mono">{formatIST(delivery.order.eventDate, "EEE d MMM yyyy")}</span>
                {" · "}
                <span className="font-mono">
                  {formatIST(delivery.order.deliveryWindowStart, "HH:mm")}–{formatIST(delivery.order.deliveryWindowEnd, "HH:mm")}
                </span>
              </div>
              {(delivery.order.roomNumber || delivery.order.tableNumber) && (
                <div>
                  {delivery.order.roomNumber && <>Room {delivery.order.roomNumber} </>}
                  {delivery.order.tableNumber && <>Table {delivery.order.tableNumber}</>}
                </div>
              )}
              {delivery.order.notes && <div className="text-ik-ink-2">Note: {delivery.order.notes}</div>}
            </div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-ik-rule text-left text-ik-ink-3">
                  <th className="py-1 font-medium">Item</th>
                  <th className="py-1 text-right font-medium">Portions</th>
                </tr>
              </thead>
              <tbody>
                {delivery.order.items.map((it, i) => (
                  <tr key={i} className="border-b border-ik-rule last:border-b-0">
                    <td className="py-1.5">{it.dish.name}</td>
                    <td className="py-1.5 text-right font-mono">
                      {it.portions.toString()} <span className="text-ik-ink-3">{it.dish.unit}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {delivery.attempts.length > 0 && (
            <div className="rounded-md border border-ik-rule bg-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Attempts</h3>
              <ul className="grid gap-1 text-[12.5px]">
                {delivery.attempts.map((a) => (
                  <li key={a.id}>
                    <span className="font-mono text-ik-ink-3">{formatIST(a.attemptedAt)}</span>{" "}
                    <span>{a.outcome}</span>
                    {a.notes && <span className="text-ik-ink-2"> · {a.notes}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="grid gap-4">
          <div className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px]">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Recipient</h3>
            <div>{delivery.order.customer.name}</div>
            {delivery.recipientName && <div className="text-ik-ink-2">{delivery.recipientName}</div>}
            {/* Phone shown only to the assigned driver (or admin/manager via the
                guard inside getDelivery). DELIVERY role sees their own only. */}
            {(isAdmin || isManager || isAssignedDriver) && delivery.recipientPhone && (
              <div className="font-mono text-ik-ink-2">{delivery.recipientPhone}</div>
            )}
          </div>
          <div className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px]">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Address</h3>
            <p>{delivery.order.deliveryAddress}</p>
            <p className="mt-2 text-ik-ink-3">
              <span className="text-ik-ink-2">Driver:</span> {delivery.driver?.name ?? "—"}
              {delivery.vehicleNo && <> · {delivery.vehicleNo}</>}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
