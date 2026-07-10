"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isNextNavigationError } from "@/lib/next-error";
import { addOrderStaff, removeOrderStaff } from "@/server/actions/staff-allocation";

export interface AllocatedStaff {
  id: string;
  staffName: string;
  duty: string | null;
}

interface Props {
  orderId: string;
  staff: AllocatedStaff[];
  /** Whether the viewer may add/remove (the server gates anyway). */
  canEdit: boolean;
  /** Tighter paddings for board cards. */
  compact?: boolean;
}

/**
 * Serving-staff allocation for an event order. Once the kitchen posts the
 * order ready, the F&B team lines up the named crew here — chips with an
 * optional duty, a tiny inline form that stays open so a whole crew (2–6
 * names, usually) can be keyed in quickly. Removal is one tap: it's
 * reversible by re-adding, so no confirmation dance.
 */
export function StaffAllocation({ orderId, staff, canEdit, compact = false }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [duty, setDuty] = useState("");

  // Nothing to show and nothing the viewer can do — render nothing.
  if (staff.length === 0 && !canEdit) return null;

  function add() {
    const staffName = name.trim();
    if (staffName.length < 2) {
      toast.error("Enter the staff member's name (at least 2 characters)");
      return;
    }
    startTransition(async () => {
      try {
        const res = await addOrderStaff({ orderId, staffName, duty: duty.trim() || null });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        // Count includes the one just added — server refresh catches up.
        toast.success(`${staff.length + 1} staff allocated`);
        // Keep the form open + duty as-is so a crew goes in name after name.
        setName("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not allocate staff");
      }
    });
  }

  function remove(row: AllocatedStaff) {
    startTransition(async () => {
      try {
        const res = await removeOrderStaff(row.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`${row.staffName} removed`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not remove staff");
      }
    });
  }

  return (
    <div className={compact ? "mt-2" : ""}>
      <div className="flex flex-wrap items-center gap-1.5">
        {staff.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1 rounded-full bg-ik-paper-alt px-2 py-0.5 text-[11.5px] text-ik-ink ring-1 ring-ik-rule"
          >
            <span className="font-medium">{s.staffName}</span>
            {s.duty && <span className="text-ik-ink-3"> · {s.duty}</span>}
            {canEdit && (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(s)}
                aria-label={`Remove ${s.staffName}`}
                title={`Remove ${s.staffName}`}
                className="ml-0.5 rounded-full px-0.5 text-[11px] leading-none text-ik-ink-3 transition hover:text-alert disabled:opacity-50"
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {canEdit && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-dashed border-ik-rule px-2 py-0.5 text-[11.5px] text-ik-ink-2 transition hover:border-brand-200 hover:text-brand"
          >
            + Allocate staff
          </button>
        )}
      </div>

      {canEdit && open && (
        <div className={"grid gap-1.5 rounded-md border border-ik-rule bg-ik-card p-2 " + (compact ? "mt-1.5" : "mt-2")}>
          <div className="flex flex-wrap gap-1.5">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Staff name"
              className="h-8 min-w-[120px] flex-1 text-[12.5px]"
              autoFocus
            />
            <Input
              value={duty}
              onChange={(e) => setDuty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="e.g. Buffet counter / Service captain"
              className="h-8 min-w-[160px] flex-1 text-[12.5px]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" disabled={pending || name.trim().length < 2} onClick={add}>
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setName("");
                setDuty("");
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
