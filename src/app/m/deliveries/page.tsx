import Link from "next/link";
import { DeliveryStatus } from "@prisma/client";
import { listDeliveries } from "@/server/actions/deliveries";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function MobileDeliveriesPage() {
  // DELIVERY role only sees their own deliveries (enforced in
  // listDeliveries via session.role === DELIVERY → mine=true).
  const deliveries = await listDeliveries({
    status: [DeliveryStatus.SCHEDULED, DeliveryStatus.DISPATCHED, DeliveryStatus.IN_TRANSIT],
  });

  return (
    <>
      <h1 className="mb-1 text-[18px] font-medium">Your deliveries</h1>
      <p className="mb-4 text-[12.5px] text-ik-ink-3">Active deliveries assigned to you. Tap a card to dispatch / arrive / confirm OTP.</p>

      {deliveries.length === 0 ? (
        <p className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px] text-ik-ink-3">
          No active deliveries. New ones will show up here automatically.
        </p>
      ) : (
        <ul className="grid gap-3">
          {deliveries.map((d) => (
            <li key={d.id}>
              <Link href={`/m/deliveries/${d.id}`} className="block rounded-md border border-ik-rule bg-ik-card p-3 hover:border-brand-200">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12.5px] font-medium text-brand-700">{d.deliveryNo}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="mt-1 text-[13px]">{d.order.customer.name}</div>
                <div className="mt-1 text-[12px] text-ik-ink-2">
                  <span className="font-mono">{formatIST(d.scheduledAt, "HH:mm")}</span>{" "}
                  · {d.order.code}
                </div>
                <div className="mt-1 text-[11.5px] text-ik-ink-3 line-clamp-2">{d.order.deliveryAddress}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
