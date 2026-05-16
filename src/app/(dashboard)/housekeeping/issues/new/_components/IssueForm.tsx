"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordHousekeepingIssue } from "@/server/actions/housekeeping";
import { isNextNavigationError } from "@/lib/next-error";

interface Item {
  id: string;
  name: string;
  unit: string;
  currentStock: string;
}
interface Room {
  id: string;
  number: string;
  name: string | null;
}
interface Staff {
  id: string;
  name: string;
}

interface Line {
  itemId: string;
  quantity: string;
}

function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function IssueForm({
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
  const [issuedAt, setIssuedAt] = useState(nowLocal());
  const [staffId, setStaffId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: "" }]);

  function addLine() {
    setLines((l) => [...l, { itemId: "", quantity: "" }]);
  }
  function removeLine(i: number) {
    setLines((l) => l.filter((_, idx) => idx !== i));
  }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function submit() {
    if (!staffId) {
      toast.error("Pick a staff member");
      return;
    }
    if (!roomId) {
      toast.error("Pick a room");
      return;
    }
    const cleanLines = lines
      .filter((l) => l.itemId && l.quantity.trim())
      .map((l) => ({ itemId: l.itemId, quantity: l.quantity.trim() }));
    if (cleanLines.length === 0) {
      toast.error("Add at least one item");
      return;
    }
    startTransition(async () => {
      try {
        await recordHousekeepingIssue({
          issuedAt,
          staffId,
          roomId,
          purpose: purpose.trim() || null,
          notes: notes.trim() || null,
          lines: cleanLines,
        });
        toast.success("Issue recorded — stock updated");
        router.push("/housekeeping/issues");
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
            <Label htmlFor="issuedAt">Issued at</Label>
            <input
              id="issuedAt"
              type="datetime-local"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
              className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="staffId">Staff (who took it)</Label>
            <select
              id="staffId"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              <option value="">— Pick staff —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="roomId">Room</Label>
            <select
              id="roomId"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              <option value="">— Pick room —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number}
                  {r.name ? ` — ${r.name}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="purpose">Purpose (optional)</Label>
            <Input
              id="purpose"
              placeholder="e.g. guest checkout, fresh linen swap"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-ik-ink-2">Items taken</div>
          <Button size="sm" variant="outline" onClick={addLine}>
            + Add item
          </Button>
        </div>
        <div className="grid gap-2">
          {lines.map((line, i) => {
            const it = items.find((x) => x.id === line.itemId);
            const overdraw =
              it &&
              line.quantity.trim() !== "" &&
              Number(line.quantity) > Number(it.currentStock);
            return (
              <div
                key={i}
                className="grid items-end gap-2 sm:grid-cols-[1fr,160px,80px]"
              >
                <div className="grid gap-1.5">
                  <Label htmlFor={`item-${i}`}>Item</Label>
                  <select
                    id={`item-${i}`}
                    value={line.itemId}
                    onChange={(e) => updateLine(i, { itemId: e.target.value })}
                    className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
                  >
                    <option value="">— Pick item —</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} (have {it.currentStock} {it.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`qty-${i}`}>
                    Qty {it ? `(${it.unit})` : ""}
                  </Label>
                  <Input
                    id={`qty-${i}`}
                    type="number"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    className={overdraw ? "border-alert" : ""}
                  />
                  {overdraw && (
                    <span className="text-[10.5px] text-alert">
                      Exceeds available
                    </span>
                  )}
                </div>
                <div>
                  {lines.length > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeLine(i)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save issue"}
        </Button>
        <Button variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
