"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DocumentEntityType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableCell, TableRow } from "@/components/ui/table";
import { DocumentUploader } from "@/components/ik/DocumentUploader";
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

export interface VoucherRowData {
  id: string;
  voucherNo: string;
  dateLabel: string;
  category: string;
  paidTo: string;
  reason: string;
  amountLabel: string;
  status: string;
  editable: boolean;
  edit: VoucherEditInput;
}

interface Props {
  voucher: VoucherRowData;
  onUpdate: (input: VoucherEditInput) => Promise<ActionResult>;
  onDelete: (reason: string) => Promise<ActionResult>;
}

type Panel = "none" | "edit" | "delete" | "bill";

/**
 * One voucher = one table row + (when a control is open) one full-width
 * panel row underneath. Keeps the table itself lean — the old design
 * stacked the attach/edit/delete forms inside a narrow cell, which was
 * unusably cramped.
 */
export function VoucherRow({ voucher, onUpdate, onDelete }: Props) {
  const [panel, setPanel] = useState<Panel>("none");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState<VoucherEditInput>(voucher.edit);
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
        setPanel("none");
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

  function toggle(next: Panel) {
    if (next === "edit") setForm(voucher.edit);
    setPanel((p) => (p === next ? "none" : next));
  }

  const linkCls = "text-[12px] font-medium text-brand hover:underline disabled:opacity-50";

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-[12px]">{voucher.voucherNo}</TableCell>
        <TableCell className="font-mono text-[12px]">{voucher.dateLabel}</TableCell>
        <TableCell>{voucher.category}</TableCell>
        <TableCell>{voucher.paidTo}</TableCell>
        <TableCell className="text-[12px] text-ik-ink-2">{voucher.reason}</TableCell>
        <TableCell className="text-right font-mono">{voucher.amountLabel}</TableCell>
        <TableCell>{voucher.status}</TableCell>
        <TableCell className="whitespace-nowrap text-right">
          {voucher.editable ? (
            <span className="inline-flex items-center gap-2.5">
              <button type="button" className={linkCls} onClick={() => toggle("edit")}>Edit</button>
              <button type="button" className={linkCls} onClick={() => toggle("bill")}>Bill</button>
              <button type="button" className="text-[12px] font-medium text-red-700 hover:underline" onClick={() => toggle("delete")}>
                Delete
              </button>
            </span>
          ) : (
            <span className="text-[11px] uppercase tracking-wide text-ik-ink-3">—</span>
          )}
        </TableCell>
      </TableRow>

      {panel !== "none" && (
        <TableRow className="bg-ik-paper-alt/60">
          <TableCell colSpan={8} className="p-3">
            {panel === "edit" && (
              <form onSubmit={saveEdit} className="grid items-end gap-3 sm:grid-cols-[110px,1fr,1fr,1.4fr,190px,auto]">
                <div className="grid gap-1">
                  <Label className="text-[11px]">Amount (₹)</Label>
                  <Input type="number" step="0.01" min="0.01" className="h-8" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px]">Category</Label>
                  <Input className="h-8" value={form.category} onChange={(e) => set("category", e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px]">Paid to</Label>
                  <Input className="h-8" value={form.paidTo} onChange={(e) => set("paidTo", e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px]">Reason</Label>
                  <Input className="h-8" value={form.reason} onChange={(e) => set("reason", e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px]">Paid on</Label>
                  <Input type="datetime-local" className="h-8" value={form.paidAt} onChange={(e) => set("paidAt", e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setPanel("none")}>Cancel</Button>
                </div>
              </form>
            )}

            {panel === "delete" && (
              <form onSubmit={confirmDelete} className="flex flex-wrap items-center gap-3">
                <span className="text-[12px] font-medium text-red-700">
                  Hard delete — the balance is restored and only the audit log keeps a trace.
                </span>
                <Input
                  placeholder="Reason (required)"
                  className="h-8 w-72"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                />
                <Button type="submit" size="sm" variant="destructive" disabled={pending}>
                  {pending ? "Deleting…" : "Confirm delete"}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setPanel("none"); setDeleteReason(""); }}>
                  Cancel
                </Button>
              </form>
            )}

            {panel === "bill" && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[12px] text-ik-ink-2">Attach the physical bill / receipt (PDF, JPEG or PNG · up to 10 MB):</span>
                <DocumentUploader
                  entityType={DocumentEntityType.PETTY_CASH_VOUCHER}
                  entityId={voucher.id}
                  label="Attach bill"
                  onUploaded={() => setPanel("none")}
                />
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
