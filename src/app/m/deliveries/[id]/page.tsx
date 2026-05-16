import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveryStatus, PaymentMethod } from "@prisma/client";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  confirmDeliveryOTP,
  dispatchDelivery,
  failDelivery,
  getDelivery,
  markDeliveryArrived,
} from "@/server/actions/deliveries";
import { formatIST } from "@/lib/time";
import { MobileDeliveryControls } from "./_components/MobileDeliveryControls";

export const dynamic = "force-dynamic";

export default async function MobileDeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const delivery = await getDelivery(id);
  if (!delivery) notFound();

  async function doDispatch() { "use server"; await dispatchDelivery(id); }
  async function doArrived() { "use server"; await markDeliveryArrived(id); }
  async function doOTP(payload: {
    otp?: string;
    paymentCollected: boolean;
    paymentAmount?: string;
    paymentMethod?: PaymentMethod;
    paymentReference?: string;
  }) {
    "use server";
    await confirmDeliveryOTP(id, payload);
  }
  async function doFail(reason: string) {
    "use server";
    await failDelivery(id, { reason });
  }

  const phoneLink = delivery.recipientPhone ? `tel:${delivery.recipientPhone.replace(/\s+/g, "")}` : null;
  const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.order.deliveryAddress)}`;

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <Link href="/m/deliveries" className="text-[12.5px] text-brand">&larr; Back</Link>
        <StatusBadge status={delivery.status} />
      </div>

      <h1 className="text-[18px] font-medium">{delivery.order.customer.name}</h1>
      <div className="font-mono text-[12.5px] text-ik-ink-3">{delivery.deliveryNo} · order {delivery.order.code}</div>
      <div className="mt-1 text-[12px] text-ik-ink-2">
        Scheduled <span className="font-mono">{formatIST(delivery.scheduledAt, "EEE d MMM HH:mm")}</span>
      </div>

      <section className="mt-4 rounded-md border border-ik-rule bg-ik-card p-3 text-[13px]">
        <h2 className="font-medium text-ik-ink">Delivery address</h2>
        <p className="mt-1 text-ik-ink-2">{delivery.order.deliveryAddress}</p>
        <a href={mapLink} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block rounded bg-brand-500 px-3 py-1 text-[12.5px] font-medium text-white">
          Open in Maps
        </a>
      </section>

      <section className="mt-4 rounded-md border border-ik-rule bg-ik-card p-3 text-[13px]">
        <h2 className="font-medium text-ik-ink">Recipient</h2>
        {delivery.recipientName && <p className="mt-1">{delivery.recipientName}</p>}
        {phoneLink && (
          <a href={phoneLink} className="mt-2 inline-block rounded border border-brand-500 px-3 py-1 text-[12.5px] font-medium text-brand-700">
            Call {delivery.recipientPhone}
          </a>
        )}
      </section>

      {delivery.status !== DeliveryStatus.DELIVERED && delivery.status !== DeliveryStatus.FAILED && (
        <section className="mt-4 rounded-md border border-brand-200 bg-brand-50 p-3">
          <h2 className="mb-2 font-medium text-brand-700">Actions</h2>
          <MobileDeliveryControls
            status={delivery.status}
            onDispatch={doDispatch}
            onArrived={doArrived}
            onConfirmOTP={doOTP}
            onFail={doFail}
          />
        </section>
      )}

      {delivery.attempts.length > 0 && (
        <section className="mt-4 rounded-md border border-ik-rule bg-ik-card p-3 text-[12.5px]">
          <h2 className="mb-1 font-medium text-ik-ink">Attempts</h2>
          <ul className="grid gap-1">
            {delivery.attempts.map((a) => (
              <li key={a.id}>
                <span className="font-mono text-ik-ink-3">{formatIST(a.attemptedAt, "HH:mm")}</span> · {a.outcome}
                {a.notes && <span className="text-ik-ink-2"> · {a.notes}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
