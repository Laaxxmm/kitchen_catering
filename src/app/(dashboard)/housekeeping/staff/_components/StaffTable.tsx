"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deactivateHousekeepingStaff,
  deleteHousekeepingStaff,
  upsertHousekeepingStaff,
} from "@/server/actions/housekeeping";
import { isNextNavigationError } from "@/lib/next-error";

interface Staff {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
}

export function StaffTable({ staff }: { staff: Staff[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Partial<Staff> | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  function startCreate() {
    setEditing({ id: undefined });
    setName("");
    setPhone("");
    setNotes("");
  }
  function startEdit(s: Staff) {
    setEditing(s);
    setName(s.name);
    setPhone(s.phone ?? "");
    setNotes(s.notes ?? "");
  }

  function save() {
    if (name.trim().length < 2) {
      toast.error("Name is required (min 2 chars)");
      return;
    }
    startTransition(async () => {
      try {
        const res = await upsertHousekeepingStaff(
          {
            name: name.trim(),
            phone: phone.trim() || null,
            notes: notes.trim() || null,
            active: true,
          },
          editing?.id
        );
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(editing?.id ? "Updated" : "Staff added");
        setEditing(null);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function deactivate(id: string) {
    if (!confirm("Deactivate this staff member?")) return;
    startTransition(async () => {
      try {
        await deactivateHousekeepingStaff(id);
        toast.success("Deactivated");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  function hardDelete(s: Staff) {
    if (
      !confirm(
        `Permanently delete "${s.name}"? This cannot be undone. If they have any historical issues, the system will refuse — deactivate instead.`
      )
    )
      return;
    startTransition(async () => {
      try {
        const res = await deleteHousekeepingStaff(s.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Deleted");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  function reactivate(s: Staff) {
    startTransition(async () => {
      try {
        const res = await upsertHousekeepingStaff(
          { name: s.name, phone: s.phone, notes: s.notes, active: true },
          s.id
        );
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Reactivated");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <div className="grid gap-4">
      {editing ? (
        <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
          <div className="text-[12px] font-medium text-ik-ink-2">
            {editing.id ? "Edit staff" : "Add staff"}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                placeholder="e.g. floor 1 + 2"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : (
        <div>
          <Button onClick={startCreate}>+ Add staff</Button>
        </div>
      )}

      {staff.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          No staff yet. Add the first one above.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="font-mono text-[12px]">
                  {s.phone ?? "—"}
                </TableCell>
                <TableCell className="text-[12.5px] text-ik-ink-2">
                  {s.notes ?? "—"}
                </TableCell>
                <TableCell>
                  <span
                    className={
                      "text-[11px] " +
                      (s.active ? "text-positive" : "text-ik-ink-3")
                    }
                  >
                    {s.active ? "Active" : "Inactive"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {s.active ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(s)}
                          disabled={pending}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deactivate(s.id)}
                          disabled={pending}
                        >
                          Deactivate
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reactivate(s)}
                        disabled={pending}
                      >
                        Reactivate
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => hardDelete(s)}
                      disabled={pending}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
