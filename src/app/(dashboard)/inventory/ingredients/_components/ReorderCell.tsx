"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isNextNavigationError } from "@/lib/next-error";
import { setReorderLevel } from "@/server/actions/inventory";

/**
 * Inline-editable "reorder at" cell. Click to edit, Enter/blur to save,
 * Escape to cancel. Shows a muted "set" prompt when the level is still 0.
 */
export function ReorderCell({ id, value, canEdit }: { id: string; value: string; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [pending, startTransition] = useTransition();
  const unset = Number(value) <= 0;

  if (!canEdit) {
    return <span className="font-mono text-[12px] text-ik-ink-3">{unset ? "—" : value}</span>;
  }

  function save() {
    if (val === value) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        const res = await setReorderLevel(id, val || "0");
        if (res && res.ok === false) {
          toast.error(res.error);
          setVal(value);
          return;
        }
        toast.success("Reorder level updated");
        setEditing(false);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not update");
        setVal(value);
      }
    });
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        step="0.001"
        min="0"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setVal(value);
            setEditing(false);
          }
        }}
        disabled={pending}
        className="h-7 w-20 rounded border border-brand-300 bg-ik-card px-1.5 text-right font-mono text-[12px]"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={
        "rounded px-1.5 py-0.5 font-mono text-[12px] hover:bg-ik-paper-alt " +
        (unset ? "italic text-ik-ink-3" : "text-ik-ink-2")
      }
    >
      {unset ? "set" : value}
    </button>
  );
}
