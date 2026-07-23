import Link from "next/link";
import { DeliveryStatus } from "@prisma/client";
import { formatIST } from "@/lib/time";

interface DeliveryItem {
  id: string;
  deliveryNo: string;
  status: DeliveryStatus;
  scheduledAt: string;
  vehicleNo: string | null;
  orderCode: string;
  customerName: string;
  deliveryAddress: string;
}

interface Props {
  deliveries: DeliveryItem[];
}

const STATUS_LABEL: Partial<Record<DeliveryStatus, string>> = {
  SCHEDULED: "Not yet dispatched",
  DISPATCHED: "On the way",
  IN_TRANSIT: "In transit",
};

const STATUS_TONE: Partial<Record<DeliveryStatus, "info" | "urgent" | "muted">> = {
  SCHEDULED: "urgent",
  DISPATCHED: "info",
  IN_TRANSIT: "info",
};

/**
 * Driver's dashboard panel: every delivery assigned to them that's still
 * in flight. Each row is a button-sized link to the delivery detail page
 * where the driver dispatches and confirms hand-over.
 */
export function MyDeliveries({ deliveries }: Props) {
  if (deliveries.length === 0) {
    return (
      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-5">
        <div className="text-[14px] font-medium text-ik-ink">No deliveries assigned right now.</div>
        <p className="mt-1 text-[12.5px] text-ik-ink-2">
          When the manager schedules a delivery and assigns it to you, it shows up here automatically.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">My deliveries</h2>
      <ul className="grid gap-2">
        {deliveries.map((d) => {
          const tone = STATUS_TONE[d.status] ?? "muted";
          const label = STATUS_LABEL[d.status] ?? d.status;
          return (
            <li key={d.id}>
              <Link
                href={`/deliveries/${d.id}`}
                className={
                  "block rounded-md border p-3 transition hover:border-brand-500 " +
                  (tone === "urgent"
                    ? "border-amber bg-amber-wash"
                    : tone === "info"
                      ? "border-brand-200 bg-brand-50"
                      : "border-ik-rule bg-ik-card")
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-mono text-[12.5px] text-brand-700">{d.deliveryNo}</div>
                  <div className="text-[12px]">
                    <span className="text-ik-ink-3">{label}</span>
                  </div>
                </div>
                <div className="mt-1 text-[13px] text-ik-ink">
                  <strong>{d.customerName}</strong>{" "}
                  <span className="text-ik-ink-3">· order {d.orderCode}</span>
                </div>
                <div className="mt-1 text-[12.5px] text-ik-ink-2">{d.deliveryAddress}</div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11.5px] text-ik-ink-3">
                  <span>Scheduled {formatIST(new Date(d.scheduledAt), "EEE d MMM HH:mm")}</span>
                  {d.vehicleNo && <span>· Vehicle {d.vehicleNo}</span>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
