"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HousekeepingJobType, JobPriority } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createHousekeepingJob } from "@/server/actions/housekeeping-jobs";
import { HK_JOB_TYPE_LABEL, JOB_PRIORITY_LABEL } from "@/lib/housekeeping-job-validators";
import { nowLocalInput } from "@/lib/datetime-local";

interface Room {
  id: string;
  number: string;
  name: string | null;
}
interface Staff {
  id: string;
  name: string;
}

const SELECT = "h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]";

export function JobForm({ rooms, staff }: { rooms: Room[]; staff: Staff[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<HousekeepingJobType>(HousekeepingJobType.GUEST_REQUEST);
  const [priority, setPriority] = useState<JobPriority>(JobPriority.NORMAL);
  const [roomId, setRoomId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [reportedAt, setReportedAt] = useState(nowLocalInput);

  function submit() {
    if (description.trim().length < 3) {
      toast.error("Say what needs doing");
      return;
    }
    startTransition(async () => {
      const res = await createHousekeepingJob({
        type,
        priority,
        roomId: roomId || null,
        staffId: staffId || null,
        description,
        notes: notes || null,
        reportedAt,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Job opened");
      router.push(`/housekeeping/jobs/${res.id}`);
    });
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="type">Type</Label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value as HousekeepingJobType)} className={SELECT}>
              {Object.values(HousekeepingJobType).map((t) => (
                <option key={t} value={t}>{HK_JOB_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="priority">Priority</Label>
            <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)} className={SELECT}>
              {Object.values(JobPriority).map((p) => (
                <option key={p} value={p}>{JOB_PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reportedAt">Reported at</Label>
            <input
              id="reportedAt"
              type="datetime-local"
              value={reportedAt}
              onChange={(e) => setReportedAt(e.target.value)}
              className={SELECT}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="roomId">Room (optional)</Label>
            <select id="roomId" value={roomId} onChange={(e) => setRoomId(e.target.value)} className={SELECT}>
              <option value="">— No room —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.number}{r.name ? ` — ${r.name}` : ""}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="staffId">Assign to (optional)</Label>
            <select id="staffId" value={staffId} onChange={(e) => setStaffId(e.target.value)} className={SELECT}>
              <option value="">— Unassigned —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="description">What needs doing</Label>
          <Textarea
            id="description"
            maxLength={1000}
            placeholder="e.g. Guest in 102 wants two extra towels"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea id="notes" maxLength={1000} className="min-h-[56px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </section>
      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : "Open job"}</Button>
        <Button variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
      </div>
    </div>
  );
}
