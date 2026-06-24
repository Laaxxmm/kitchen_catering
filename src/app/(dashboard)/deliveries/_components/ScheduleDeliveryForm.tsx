"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ik/FormKit";
import { isNextNavigationError } from "@/lib/next-error";

interface OrderOption { id: string; code: string; customerName: string; eventDate: string }
interface DriverOption { id: string; name: string }

interface Props {
  orders: OrderOption[];
  drivers: DriverOption[];
  onSubmit: (input: { orderId: string; driverUserId: string; vehicleNo: string | null; scheduledAt: string }) => Promise<{ id: string; deliveryNo: string }>;
  // Pre-select an order when the page was reached via "Schedule delivery
  // for ORD-XX" from the order detail page.
  initialOrderId?: string | null;
}

export function ScheduleDeliveryForm({ orders, drivers, onSubmit, initialOrderId }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const prefilled = initialOrderId && orders.some((o) => o.id === initialOrderId) ? initialOrderId : null;
  const [orderId, setOrderId] = useState(prefilled ?? orders[0]?.id ?? "");
  const [driverUserId, setDriverUserId] = useState(drivers[0]?.id ?? "");
  const [vehicleNo, setVehicleNo] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return toast.error("Pick an order");
    if (!driverUserId) return toast.error("Pick a driver");
    if (!scheduledAt) return toast.error("Set scheduled time");
    startTransition(async () => {
      try {
        const result = await onSubmit({
          orderId, driverUserId,
          vehicleNo: vehicleNo || null,
          scheduledAt,
        });
        toast.success(`Scheduled ${result.deliveryNo}`);
        router.push(`/deliveries/${result.id}`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title="Nothing ready to schedule"
        body="A delivery can only be scheduled once an order is marked READY on the kitchen board. None are waiting right now."
        action={<Link href="/kitchen"><Button>Go to kitchen board →</Button></Link>}
      />
    );
  }
  if (drivers.length === 0) {
    return (
      <EmptyState
        title="No drivers yet"
        body="Add a user with the DELIVERY role before scheduling a run."
        action={<Link href="/admin/users"><Button>Add a driver →</Button></Link>}
      />
    );
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-4">
      <section className="grid gap-3 rounded-[14px] border border-ik-rule bg-ik-card p-4 sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Delivery run</h3>
        <div className="grid gap-1">
          <Label htmlFor="orderId">Order<span className="text-gold" aria-hidden> *</span></Label>
          <select
            id="orderId"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            {orders.map((o) => (
              <option key={o.id} value={o.id}>{o.code} · {o.customerName}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="driverUserId">Driver<span className="text-gold" aria-hidden> *</span></Label>
            <select
              id="driverUserId"
              value={driverUserId}
              onChange={(e) => setDriverUserId(e.target.value)}
              className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="vehicleNo">Vehicle no</Label>
            <Input id="vehicleNo" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="scheduledAt">Scheduled at<span className="text-gold" aria-hidden> *</span></Label>
          <Input id="scheduledAt" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-ik-rule bg-ik-paper/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-ik-paper/75 md:-mx-6 md:px-6">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Schedule"}</Button>
      </div>
    </form>
  );
}
