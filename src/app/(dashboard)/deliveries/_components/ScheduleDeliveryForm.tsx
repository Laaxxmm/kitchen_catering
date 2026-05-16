"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    return <p className="text-[13px] text-ik-ink-3">No orders in READY status. Mark an order ready from the kitchen board first.</p>;
  }
  if (drivers.length === 0) {
    return <p className="text-[13px] text-ik-ink-3">No active drivers. Add a user with DELIVERY role.</p>;
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-4">
      <div className="grid gap-1">
        <Label htmlFor="orderId">Order</Label>
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
          <Label htmlFor="driverUserId">Driver</Label>
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
          <Label htmlFor="vehicleNo">Vehicle no (optional)</Label>
          <Input id="vehicleNo" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="scheduledAt">Scheduled at</Label>
        <Input id="scheduledAt" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Schedule"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
