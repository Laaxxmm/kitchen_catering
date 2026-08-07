"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import { manpowerCost } from "@/lib/manpower";
import { formatINR } from "@/lib/money";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  /** What the requester asked for — the boxes open on these. */
  people: number;
  days: number;
  rate: string;
  onApprove: (input: {
    people: number;
    days: number;
    ratePerPersonPerDay: string;
    note: string | null;
  }) => Promise<ActionResult>;
}

/**
 * Approve with the numbers editable in place. The boxes start on what was
 * asked for; whatever they say when Approve is pressed is what the business
 * commits to. The original ask is never written over — it stays on the row
 * for the report, so the edit is visible afterwards rather than silent.
 */
export function ApproveForm({ people, days, rate, onApprove }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [p, setP] = useState(String(people));
  const [d, setD] = useState(String(days));
  const [r, setR] = useState(rate);
  const [note, setNote] = useState("");

  const asked = manpowerCost(people, days, rate);
  const approving = manpowerCost(Number(p), Number(d), r);
  const changed = Number(p) !== people || Number(d) !== days || !approving.eq(asked);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(Number(p) >= 1) || !(Number(d) >= 1)) return toast.error("People and days must be at least 1");
    if (!r.trim() || !(Number(r) > 0)) return toast.error("Enter a rate per person per day");
    startTransition(async () => {
      try {
        const res = await onApprove({
          people: Number(p),
          days: Number(d),
          ratePerPersonPerDay: r.trim(),
          note: note.trim() || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(changed ? "Approved with your figures" : "Approved as asked");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not approve");
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card">
      <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Approve</h3>
      <p className="mb-3 text-[12px] text-ik-ink-3">
        Approve as asked, or change the count, days or rate first — the original ask is kept either way.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="apPeople">People</Label>
          <Input id="apPeople" type="number" min="1" step="1" value={p} onChange={(e) => setP(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="apDays">Days</Label>
          <Input id="apDays" type="number" min="1" step="1" value={d} onChange={(e) => setD(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="apRate">Rate per person per day (₹)</Label>
          <Input id="apRate" type="number" min="0" step="0.01" value={r} onChange={(e) => setR(e.target.value)} />
        </div>
      </div>

      <div className="mt-3 rounded-md border border-ik-rule bg-ik-paper-alt px-3 py-2 text-[13px]">
        <span className="text-ik-ink-3">Approving</span>{" "}
        <span className="font-mono text-[15px] text-ik-ink">{formatINR(approving)}</span>
        {changed && (
          <div className="mt-1 text-[12px] text-amber">
            Changed from the {formatINR(asked)} asked for ({people} × {days} day
            {days === 1 ? "" : "s"}).
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-1">
        <Label htmlFor="apNote">Note (optional)</Label>
        <Textarea id="apNote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the figures changed, or anything the requester should know." />
      </div>

      <div className="mt-3">
        <Button type="submit" disabled={pending}>{pending ? "Approving…" : "Approve"}</Button>
      </div>
    </form>
  );
}
