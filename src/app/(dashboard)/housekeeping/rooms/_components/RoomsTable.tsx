"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RoomType } from "@prisma/client";
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
  deactivateRoom,
  deleteRoom,
  upsertRoom,
} from "@/server/actions/housekeeping";
import { isNextNavigationError } from "@/lib/next-error";

interface Room {
  id: string;
  number: string;
  name: string | null;
  type: RoomType;
  floor: string | null;
  active: boolean;
}

const TYPE_LABEL: Record<RoomType, string> = {
  STANDARD: "Standard",
  DELUXE: "Deluxe",
  SUITE: "Suite",
  COMMON_AREA: "Common area",
  OTHER: "Other",
};

export function RoomsTable({ rooms }: { rooms: Room[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Partial<Room> | null>(null);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<RoomType>(RoomType.STANDARD);
  const [floor, setFloor] = useState("");

  function startCreate() {
    setEditing({ id: undefined });
    setNumber("");
    setName("");
    setType(RoomType.STANDARD);
    setFloor("");
  }
  function startEdit(r: Room) {
    setEditing(r);
    setNumber(r.number);
    setName(r.name ?? "");
    setType(r.type);
    setFloor(r.floor ?? "");
  }

  function save() {
    if (number.trim().length < 1) {
      toast.error("Room number is required");
      return;
    }
    startTransition(async () => {
      try {
        const res = await upsertRoom(
          {
            number: number.trim(),
            name: name.trim() || null,
            type,
            floor: floor.trim() || null,
            active: true,
          },
          editing?.id
        );
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(editing?.id ? "Updated" : "Room added");
        setEditing(null);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function deactivate(id: string) {
    if (!confirm("Deactivate this room?")) return;
    startTransition(async () => {
      try {
        await deactivateRoom(id);
        toast.success("Deactivated");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  function hardDelete(r: Room) {
    if (
      !confirm(
        `Permanently delete room "${r.number}"? This cannot be undone. If the room has any historical issues, the system will refuse — deactivate instead.`
      )
    )
      return;
    startTransition(async () => {
      try {
        const res = await deleteRoom(r.id);
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

  function reactivate(r: Room) {
    startTransition(async () => {
      try {
        const res = await upsertRoom(
          {
            number: r.number,
            name: r.name,
            type: r.type,
            floor: r.floor,
            active: true,
          },
          r.id
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
        <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
          <div className="text-[12px] font-medium text-ik-ink-2">
            {editing.id ? "Edit room" : "Add room"}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="number">Number</Label>
              <Input
                id="number"
                placeholder="e.g. 101"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name (optional)</Label>
              <Input
                id="name"
                placeholder="e.g. Garden suite"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as RoomType)}
                className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
              >
                {Object.values(RoomType).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="floor">Floor (optional)</Label>
              <Input
                id="floor"
                placeholder="1, G, B1"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
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
          <Button onClick={startCreate}>+ Add room</Button>
        </div>
      )}

      {rooms.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No rooms yet. Add one above.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Floor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono font-medium">{r.number}</TableCell>
                <TableCell>{r.name ?? "—"}</TableCell>
                <TableCell className="text-[12.5px]">
                  {TYPE_LABEL[r.type]}
                </TableCell>
                <TableCell className="text-[12.5px]">{r.floor ?? "—"}</TableCell>
                <TableCell>
                  <span
                    className={
                      "text-[11px] " +
                      (r.active ? "text-positive" : "text-ik-ink-3")
                    }
                  >
                    {r.active ? "Active" : "Inactive"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {r.active ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(r)}
                          disabled={pending}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deactivate(r.id)}
                          disabled={pending}
                        >
                          Deactivate
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reactivate(r)}
                        disabled={pending}
                      >
                        Reactivate
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => hardDelete(r)}
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
