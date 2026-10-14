"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HousekeepingJobType, JobPriority, type DeptJobStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelHousekeepingJob,
  completeHousekeepingJob,
  startHousekeepingJob,
  updateHousekeepingJob,
} from "@/server/actions/housekeeping-jobs";
import { HK_JOB_TYPE_LABEL, JOB_PRIORITY_LABEL } from "@/lib/housekeeping-job-validators";

interface Option {
  id: string;
  label: string;
}
interface Item {
  id: string;
  name: string;
  unit: string;
  reusable: boolean;
  currentStock: string;
}
interface Job {
  id: string;
  status: DeptJobStatus;
  type: HousekeepingJobType;
  priority: JobPriority;
  roomId: string | null;
  staffId: string | null;
  description: string;
  notes: string | null;
}

const SELECT = "h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]";
const CARD = "grid content-start gap-3 rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card";

/** Assign / edit, start, complete (with the items used) and cancel for one live job. */
export function JobActions({
  job,
  rooms,
  staff,
  items,
}: {
  job: Job;
  rooms: Option[];
  staff: Option[];
  items: Item[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Edit / assign
  const [type, setType] = useState(job.type);
  const [priority, setPriority] = useState(job.priority);
  const [roomId, setRoomId] = useState(job.roomId ?? "");
  const [staffId, setStaffId] = useState(job.staffId ?? "");
  const [description, setDescription] = useState(job.description);
  const [notes, setNotes] = useState(job.notes ?? "");

  // Complete
  const [outcome, setOutcome] = useState("");
  const [lines, setLines] = useState<Array<{ itemId: string; qty: string }>>([]);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  function save() {
    run(
      () =>
        updateHousekeepingJob(job.id, {
          type,
          priority,
          roomId: roomId || null,
          staffId: staffId || null,
          description,
          notes: notes || null,
        }),
      "Job saved",
    );
  }

  function start() {
    if (!staffId) {
      toast.error("Assign a staff member before starting the job");
      return;
    }
    run(() => startHousekeepingJob(job.id, { staffId }), "Job started");
  }

  function complete() {
    const half = lines.findIndex((l) => !!l.itemId !== !!l.qty.trim());
    if (half >= 0) {
      toast.error(`Line ${half + 1}: pick an item and enter a quantity, or remove the line`);
      return;
    }
    const used = lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: l.qty.trim() }));
    if (used.length > 0 && (!roomId || !staffId)) {
      toast.error("Items were used — pick the room and the staff member they went with");
      return;
    }
    run(
      () =>
        completeHousekeepingJob(job.id, {
          outcome,
          items: used,
          roomId: roomId || null,
          staffId: staffId || null,
        }),
      used.length > 0 ? "Job done — items taken from stock" : "Job done",
    );
  }

  function cancel() {
    const reason = window.prompt("Why is this job cancelled?");
    if (reason === null) return;
    run(() => cancelHousekeepingJob(job.id, reason), "Job cancelled");
  }

  const updateLine = (i: number, patch: Partial<{ itemId: string; qty: string }>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <div className="grid content-start gap-4">
      <section className={CARD}>
        <div className="text-[12px] font-medium text-ik-ink-2">Job details and assignment</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="type">Type</Label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value as HousekeepingJobType)} className={SELECT}>
              {Object.values(HousekeepingJobType).map((t) => <option key={t} value={t}>{HK_JOB_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="priority">Priority</Label>
            <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)} className={SELECT}>
              {Object.values(JobPriority).map((p) => <option key={p} value={p}>{JOB_PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="roomId">Room</Label>
            <select id="roomId" value={roomId} onChange={(e) => setRoomId(e.target.value)} className={SELECT}>
              <option value="">— No room —</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="staffId">Staff</Label>
            <select id="staffId" value={staffId} onChange={(e) => setStaffId(e.target.value)} className={SELECT}>
              <option value="">— Unassigned —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="description">What needs doing</Label>
          <Textarea id="description" maxLength={1000} className="min-h-[56px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" maxLength={1000} className="min-h-[56px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={save} disabled={pending}>Save</Button>
          {job.status === "OPEN" && <Button onClick={start} disabled={pending}>Start job</Button>}
          <Button variant="outline" onClick={cancel} disabled={pending}>Cancel job</Button>
        </div>
      </section>

      <section className={CARD}>
        <div className="text-[12px] font-medium text-ik-ink-2">Close the job</div>
        <div className="grid gap-1.5">
          <Label htmlFor="outcome">What was done</Label>
          <Textarea
            id="outcome"
            maxLength={1000}
            className="min-h-[56px]"
            placeholder="e.g. Room cleaned, two towels and a soap left"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[11.5px] text-ik-ink-3">
            Items used come out of the housekeeping store, to the room and staff above.
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={lines.length >= 50}
            onClick={() => setLines((ls) => [...ls, { itemId: "", qty: "" }])}
          >
            + Item used
          </Button>
        </div>
        {lines.map((line, i) => {
          const it = items.find((x) => x.id === line.itemId);
          const over = it && line.qty.trim() !== "" && Number(line.qty) > Number(it.currentStock);
          const taken = new Set(lines.filter((_, idx) => idx !== i).map((l) => l.itemId));
          return (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr,130px,auto]">
              <div className="grid gap-1.5">
                <Label htmlFor={`item-${i}`}>Item</Label>
                <select id={`item-${i}`} value={line.itemId} onChange={(e) => updateLine(i, { itemId: e.target.value })} className={SELECT}>
                  <option value="">— Pick item —</option>
                  {items.map((x) => (
                    <option key={x.id} value={x.id} disabled={taken.has(x.id)}>
                      {x.name} (have {x.currentStock} {x.unit}){x.reusable ? " · reusable" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`qty-${i}`}>Qty {it ? `(${it.unit})` : ""}</Label>
                <Input
                  id={`qty-${i}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  value={line.qty}
                  onChange={(e) => updateLine(i, { qty: e.target.value })}
                  className={over ? "border-alert" : ""}
                />
                {over && <span className="text-[10.5px] text-alert">More than on hand</span>}
              </div>
              <Button size="sm" variant="outline" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                Remove
              </Button>
            </div>
          );
        })}
        <div>
          <Button onClick={complete} disabled={pending}>{pending ? "Saving…" : "Mark done"}</Button>
        </div>
      </section>
    </div>
  );
}
