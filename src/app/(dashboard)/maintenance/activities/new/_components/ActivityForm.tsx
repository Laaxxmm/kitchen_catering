"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MaintenanceActivityStatus, MaintenanceCategory } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recordMaintenanceActivity } from "@/server/actions/maintenance";
import { isNextNavigationError } from "@/lib/next-error";

interface Item {
  id: string;
  name: string;
  unit: string;
  category: MaintenanceCategory;
  currentStock: string;
}
interface Room { id: string; number: string; name: string | null; }
interface Staff { id: string; name: string; category: MaintenanceCategory; }
interface Line { itemId: string; quantity: string; }

const CAT_LABEL: Record<MaintenanceCategory, string> = {
  ELECTRICAL: "Electrical",
  MECHANICAL: "Mechanical",
  GENERAL: "General",
};

function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function ActivityForm({
  items,
  rooms,
  staff,
}: {
  items: Item[];
  rooms: Room[];
  staff: Staff[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [performedAt, setPerformedAt] = useState(nowLocal());
  const [staffId, setStaffId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory>(MaintenanceCategory.GENERAL);
  const [status, setStatus] = useState<MaintenanceActivityStatus>(MaintenanceActivityStatus.COMPLETED);
  const [issueReported, setIssueReported] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  // Auto-set category to the staff member's primary skill when they
  // change the staff dropdown.
  useEffect(() => {
    if (!staffId) return;
    const s = staff.find((x) => x.id === staffId);
    if (s) setCategory(s.category);
  }, [staffId, staff]);

  function addLine() { setLines((l) => [...l, { itemId: "", quantity: "" }]); }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function submit() {
    if (!staffId) { toast.error("Pick a staff member"); return; }
    if (!roomId) { toast.error("Pick a room"); return; }
    if (issueReported.trim().length < 2) { toast.error("Describe the issue reported"); return; }

    const cleanLines = lines
      .filter((l) => l.itemId && l.quantity.trim())
      .map((l) => ({ itemId: l.itemId, quantity: l.quantity.trim() }));

    startTransition(async () => {
      try {
        await recordMaintenanceActivity({
          performedAt,
          staffId,
          roomId,
          category,
          status,
          issueReported: issueReported.trim(),
          workDone: workDone.trim() || null,
          notes: notes.trim() || null,
          lines: cleanLines,
        });
        toast.success("Activity recorded");
        router.push("/maintenance/activities");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <div className="grid max-w-4xl gap-4">
      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="performedAt">Performed at</Label>
            <input id="performedAt" type="datetime-local" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="staffId">Staff (who did the work)</Label>
            <select id="staffId" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              <option value="">— Pick staff —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {CAT_LABEL[s.category]}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="roomId">Room</Label>
            <select id="roomId" value={roomId} onChange={(e) => setRoomId(e.target.value)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              <option value="">— Pick room —</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.number}{r.name ? ` — ${r.name}` : ""}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="category">Category</Label>
            <select id="category" value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              {Object.values(MaintenanceCategory).map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
            <p className="text-[11px] text-ik-ink-3">Auto-set from staff. Override if needed.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="status">Status</Label>
            <select id="status" value={status} onChange={(e) => setStatus(e.target.value as MaintenanceActivityStatus)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              {Object.values(MaintenanceActivityStatus).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="issueReported">Issue reported</Label>
          <Textarea id="issueReported" rows={2} placeholder="e.g. AC not cooling, tap dripping" value={issueReported} onChange={(e) => setIssueReported(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="workDone">Work done (optional)</Label>
          <Textarea id="workDone" rows={2} placeholder="e.g. replaced capacitor, tightened washer" value={workDone} onChange={(e) => setWorkDone(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </section>

      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-ik-ink-2">Spares used (optional)</div>
          <Button size="sm" variant="outline" onClick={addLine}>+ Add item</Button>
        </div>
        {lines.length === 0 ? (
          <p className="text-[12px] text-ik-ink-3">Pure-labour activity — no items needed. Click <span className="font-medium">+ Add item</span> if anything was consumed.</p>
        ) : (
          <div className="grid gap-2">
            {lines.map((line, i) => {
              const it = items.find((x) => x.id === line.itemId);
              const overdraw = it && line.quantity.trim() !== "" && Number(line.quantity) > Number(it.currentStock);
              return (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr,160px,80px]">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`item-${i}`}>Item</Label>
                    <select id={`item-${i}`} value={line.itemId} onChange={(e) => updateLine(i, { itemId: e.target.value })} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
                      <option value="">— Pick item —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          [{CAT_LABEL[it.category].slice(0, 4).toUpperCase()}] {it.name} (have {it.currentStock} {it.unit})
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
                      value={line.quantity}
                      onChange={(e) => updateLine(i, { quantity: e.target.value })}
                      className={overdraw ? "border-alert" : ""}
                    />
                    {overdraw && <span className="text-[10.5px] text-alert">Exceeds available</span>}
                  </div>
                  <div><Button size="sm" variant="outline" onClick={() => removeLine(i)}>Remove</Button></div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : "Save activity"}</Button>
        <Button variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
      </div>
    </div>
  );
}
