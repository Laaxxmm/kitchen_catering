"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

export interface VoucherEditInput {
  amount: string;
  category: string;
  paidTo: string;
  reason: string;
  /** `datetime-local` value (YYYY-MM-DDTHH:mm). */
  paidAt: string;
}

interface Props {
  /** Current voucher values used to prefill the edit form. */
  initial: VoucherEditInput;
  /** Bound "use server" shims that RETURN the action's result. */
  onUpdate: (input: VoucherEditInput) => Promise<ActionResult>;
  onDelete: (reason: string) => Promise<ActionResult>;
}

/**
 * Per-voucher Edit / Delete controls for the float detail table. Same
 * contract as InlineReasonForm: refusals from the action toast, the row
 * refreshes on success. Delete is a HARD delete (the audit row is the only
 * trace), so it demands a reason and an explicit confirm.
 */
export function VoucherRowActions({ initial, onUpdate, onDelete }: Props) {
  const [mode, setMode] = useState<"idle" | "edit" | "delete">("idle");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState<VoucherEditInput>(initial);
  const [deleteReason, setDeleteReason] = useState("");

  function set<K extends keyof VoucherEditInput>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function run(fn: () => Promise<ActionResult>, successMessage: string) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(successMessage);
        setMode("idle");
        setDeleteReason("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || !form.category.trim() || !form.paidTo.trim() || !form.reason.trim() || !form.paidAt) {
      toast.error("Please fill in all fields");
      return;
    }
    run(
      () =>
        onUpdate({
          amount: form.amount,
          category: form.category.trim(),
          paidTo: form.paidTo.trim(),
          reason: form.reason.trim(),
          paidAt: form.paidAt,
        }),
      "Voucher updated",
    );
  }

  function confirmDelete(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = deleteReason.trim();
    if (!trimmed) {
      toast.error("Please enter a reason");
      return;
    }
    run(() => onDelete(trimmed), "Voucher deleted");
  }

  if (mode === "idle") {
    return (
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="outline" onClick={() => { setForm(initial); setMode("edit"); }}>
          Edit
        </Button>
        <Button type="button" size="sm" variant="outline" className="text-red-700" onClick={() => setMode("delete")}>
          Delete
        </Button>
      </div>
    );
  }

  if (mode === "edit") {
    return (
      <form onSubmit={saveEdit} className="grid w-56 gap-2 rounded border border-ik-rule bg-ik-paper-alt p-2 text-left">
        <div className="grid gap-1">
          <Label htmlFor={`edit-amount-${initial.paidAt}`} className="text-[11px]">Amount (₹)</Label>
          <Input id={`edit-amount-${initial.paidAt}`} type="number" step="0.01" min="0.01" className="h-7 text-[12px]" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px]">Category</Label>
          <Input className="h-7 text-[12px]" value={form.category} onChange={(e) => set("category", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px]">Paid to</Label>
          <Input className="h-7 text-[12px]" value={form.paidTo} onChange={(e) => set("paidTo", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px]">Reason</Label>
          <Input className="h-7 text-[12px]" value={form.reason} onChange={(e) => set("reason", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px]">Paid on</Label>
          <Input type="datetime-local" className="h-7 text-[12px]" value={form.paidAt} onChange={(e) => set("paidAt", e.target.value)} />
        </div>
        <div className="flex gap-1">
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setMode("idle")}>Cancel</Button>
        </div>
      </form>
    );
  }

  // mode === "delete"
  return (
    <form onSubmit={confirmDelete} className="grid w-56 gap-2 rounded border border-ik-rule bg-ik-paper-alt p-2 text-left">
      <p className="text-[11px] text-red-700">
        Hard delete — the voucher row is removed for good; only the audit log keeps a trace.
      </p>
      <Input
        placeholder="Reason (required)"
        className="h-7 text-[12px]"
        value={deleteReason}
        onChange={(e) => setDeleteReason(e.target.value)}
      />
      <div className="flex gap-1">
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {pending ? "Deleting…" : "Confirm delete"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setMode("idle"); setDeleteReason(""); }}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
