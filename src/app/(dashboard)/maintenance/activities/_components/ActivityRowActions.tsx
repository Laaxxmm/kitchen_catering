"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { MaintenanceActivityStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  assignMaintenanceActivity,
  updateMaintenanceActivityStatus,
} from "@/server/actions/maintenance";

interface StaffOption { id: string; name: string; }
interface ItemOption { id: string; name: string; unit: string; onHand: string; }
export interface JobRef {
  id: string;
  status: MaintenanceActivityStatus;
  staffId: string | null;
  /** "Room 102 — AC not cooling", for the dialog heading. */
  label: string;
}

type DialogKind = "start" | "assign" | "complete";

const JobActions = createContext<{
  staff: StaffOption[];
  items: ItemOption[];
  open: (kind: DialogKind, job: JobRef) => void;
} | null>(null);

const SELECT = "h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]";

/**
 * Holds the active staff and spares once for the whole list, and the one
 * dialog that is open — rows only carry their own job.
 */
export function JobActionsProvider({
  staff,
  items,
  children,
}: {
  staff: StaffOption[];
  items: ItemOption[];
  children: ReactNode;
}) {
  const [dialog, setDialog] = useState<{ kind: DialogKind; job: JobRef } | null>(null);
  const close = () => setDialog(null);
  return (
    <JobActions.Provider value={{ staff, items, open: (kind, job) => setDialog({ kind, job }) }}>
      {children}
      {dialog?.kind === "complete" && <CompleteDialog job={dialog.job} staff={staff} items={items} onClose={close} />}
      {(dialog?.kind === "start" || dialog?.kind === "assign") && (
        <StaffDialog kind={dialog.kind} job={dialog.job} staff={staff} onClose={close} />
      )}
    </JobActions.Provider>
  );
}

/** Start / Assign / Complete / Cancel for one open job. Terminal jobs render nothing. */
export function ActivityRowActions({ job }: { job: JobRef }) {
  const ctx = useContext(JobActions);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!ctx || job.status === "COMPLETED" || job.status === "CANCELLED") return null;

  function run(status: "IN_PROGRESS" | "CANCELLED", done: string) {
    startTransition(async () => {
      const res = await updateMaintenanceActivityStatus(job.id, { status });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  const start = () => {
    if (!job.staffId) ctx.open("start", job);
    else run("IN_PROGRESS", "Job started");
  };

  function cancel() {
    if (!window.confirm("Cancel this job? Any spares it drew go back to stock.")) return;
    run("CANCELLED", "Job cancelled — spares back in stock");
  }

  return (
    <div className="flex justify-end gap-1">
      {job.status === "PENDING" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={start}>Start</Button>
      )}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => ctx.open("assign", job)}>
        {job.staffId ? "Reassign" : "Assign"}
      </Button>
      <Button size="sm" disabled={pending} onClick={() => ctx.open("complete", job)}>Complete</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={cancel}>Cancel</Button>
    </div>
  );
}

function StaffDialog({
  kind,
  job,
  staff,
  onClose,
}: {
  kind: "start" | "assign";
  job: JobRef;
  staff: StaffOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [staffId, setStaffId] = useState(job.staffId ?? "");

  function save() {
    if (!staffId) {
      toast.error("Pick a staff member");
      return;
    }
    startTransition(async () => {
      const res =
        kind === "start"
          ? await updateMaintenanceActivityStatus(job.id, { status: "IN_PROGRESS", staffId })
          : await assignMaintenanceActivity(job.id, staffId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(kind === "start" ? "Job started" : "Job assigned");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && !pending && onClose()}
      title={kind === "start" ? "Start job" : job.staffId ? "Reassign job" : "Assign job"}
      description={job.label}
    >
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="job-staff">Staff member</Label>
          <select id="job-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)} className={SELECT}>
            <option value="">— Pick staff —</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={onClose}>Back</Button>
          <Button disabled={pending} onClick={save}>
            {pending ? "Saving…" : kind === "start" ? "Start job" : "Assign"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

interface PartLine { itemId: string; qty: string; }

function CompleteDialog({
  job,
  staff,
  items,
  onClose,
}: {
  job: JobRef;
  staff: StaffOption[];
  items: ItemOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [staffId, setStaffId] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [parts, setParts] = useState<PartLine[]>([]);

  const update = (i: number, patch: Partial<PartLine>) =>
    setParts((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  function save() {
    if (!job.staffId && !staffId) {
      toast.error("Pick who did the work");
      return;
    }
    if (!workDone.trim()) {
      toast.error("Say what work was done");
      return;
    }
    // Half a line is a mistake, not noise; a wholly blank one is an unused "+ Add part".
    const half = parts.findIndex((p) => Boolean(p.itemId) !== Boolean(p.qty.trim()));
    if (half >= 0) {
      toast.error(`Part ${half + 1} needs both an item and a quantity — fill it in or remove it`);
      return;
    }
    startTransition(async () => {
      const res = await updateMaintenanceActivityStatus(job.id, {
        status: "COMPLETED",
        workDone: workDone.trim(),
        staffId: job.staffId ? null : staffId,
        parts: parts.filter((p) => p.itemId).map((p) => ({ itemId: p.itemId, qty: p.qty.trim() })),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Job completed");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && !pending && onClose()}
      title="Complete job"
      description={job.label}
      className="max-w-xl"
    >
      <div className="grid gap-3">
        {!job.staffId && (
          <div className="grid gap-1.5">
            <Label htmlFor="done-staff">Who did the work</Label>
            <select id="done-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)} className={SELECT}>
              <option value="">— Pick staff —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="done-work">Work done</Label>
          <Textarea
            id="done-work"
            rows={2}
            maxLength={1000}
            placeholder="e.g. replaced capacitor, tightened washer"
            value={workDone}
            onChange={(e) => setWorkDone(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-ik-ink-2">Spares used</span>
            <Button
              size="sm"
              variant="outline"
              disabled={parts.length >= 50}
              onClick={() => setParts((rows) => [...rows, { itemId: "", qty: "" }])}
            >
              + Add part
            </Button>
          </div>
          {parts.length === 0 && (
            <p className="text-[12px] text-ik-ink-3">Labour only? Leave this empty. Each part is taken off the shelf.</p>
          )}
          {parts.map((p, i) => {
            const item = items.find((it) => it.id === p.itemId);
            const over = item && p.qty.trim() !== "" && Number(p.qty) > Number(item.onHand);
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr,110px,auto]">
                <div className="grid gap-1">
                  <Label htmlFor={`part-${i}`}>Item</Label>
                  <select id={`part-${i}`} value={p.itemId} onChange={(e) => update(i, { itemId: e.target.value })} className={SELECT}>
                    <option value="">— Pick item —</option>
                    {items.map((it) => (
                      // One line per spare: an item already on another line is greyed out.
                      <option
                        key={it.id}
                        value={it.id}
                        disabled={it.id !== p.itemId && parts.some((o) => o.itemId === it.id)}
                      >
                        {it.name} (have {it.onHand} {it.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`part-qty-${i}`}>Qty {item ? `(${item.unit})` : ""}</Label>
                  <Input
                    id={`part-qty-${i}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.001"
                    value={p.qty}
                    onChange={(e) => update(i, { qty: e.target.value })}
                    className={over ? "border-alert" : ""}
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => setParts((rows) => rows.filter((_, idx) => idx !== i))}>
                  Remove
                </Button>
                {over && <span className="text-[10.5px] text-alert sm:col-span-3">More than the {item.onHand} {item.unit} in stock</span>}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={onClose}>Back</Button>
          <Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Complete job"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
