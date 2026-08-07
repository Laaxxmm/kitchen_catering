"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { isNextNavigationError } from "@/lib/next-error";
import { manpowerCost } from "@/lib/manpower";
import { formatINR } from "@/lib/money";
import { createManpowerRequest } from "@/server/actions/manpower";

interface OrderOption { id: string; label: string }

/**
 * Raise a manpower request. The rate is an estimate — accounts settle the
 * real figure after the job — so the live total below is labelled as one.
 */
export function ManpowerForm({
  orders,
  defaultOrderId,
}: {
  orders: OrderOption[];
  defaultOrderId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [orderId, setOrderId] = useState(defaultOrderId);
  const [workDescription, setWorkDescription] = useState("");
  const [people, setPeople] = useState("2");
  const [days, setDays] = useState("1");
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");

  // manpowerCost is blank-safe: an empty rate box reads as ₹0, never a throw.
  const estimate = manpowerCost(Number(people), Number(days), rate);
  const options = [{ value: "", label: "No order — general" }, ...orders.map((o) => ({ value: o.id, label: o.label }))];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (workDescription.trim().length < 3) return toast.error("Say what the work is");
    if (!(Number(people) >= 1) || !(Number(days) >= 1)) return toast.error("People and days must be at least 1");
    if (!rate.trim() || !(Number(rate) > 0)) return toast.error("Enter a rate per person per day");
    startTransition(async () => {
      try {
        const res = await createManpowerRequest({
          orderId: orderId || null,
          workDescription: workDescription.trim(),
          people: Number(people),
          days: Number(days),
          ratePerPersonPerDay: rate.trim(),
          notes: notes.trim() || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Request sent to the manager for approval");
        router.push(`/manpower/${res.id}`);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not raise the request");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-4">
      <section className="rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="work">What the work is</Label>
            <Input
              id="work"
              value={workDescription}
              onChange={(e) => setWorkDescription(e.target.value)}
              placeholder="Extra servers for the reception, pot washing, loading…"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor="people">People</Label>
              <Input id="people" type="number" min="1" step="1" value={people} onChange={(e) => setPeople(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="days">Days</Label>
              <Input id="days" type="number" min="1" step="1" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="rate">Rate per person per day (₹)</Label>
              <Input id="rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="500" />
            </div>
          </div>

          <div className="rounded-md border border-ik-rule bg-ik-paper-alt px-3 py-2 text-[13px]">
            <span className="text-ik-ink-3">Approximate cost</span>{" "}
            <span className="font-mono text-[15px] text-ik-ink">{formatINR(estimate)}</span>
            <span className="text-[12px] text-ik-ink-3">
              {" "}· {people || 0} × {days || 0} day(s). An estimate — accounts settle the real figure after the job.
            </span>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="order">Which order is it for?</Label>
            <Combobox
              id="order"
              value={orderId}
              onChange={setOrderId}
              options={options}
              placeholder="No order — general"
              emptyText="No order matches"
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="When they're needed, who arranged them, anything the manager should know." />
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send for approval"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
