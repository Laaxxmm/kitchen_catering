"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { DeptPurchaseStatus, StoreDepartment } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InlineReasonForm } from "@/components/ik/InlineReasonForm";
import { isNextNavigationError } from "@/lib/next-error";
import { nowLocalInput } from "@/lib/datetime-local";
import type { ActionResult } from "@/lib/action-result";
import {
  cancelDeptPurchaseOrder,
  closeDeptPurchaseOrderShort,
  decideDeptPurchaseOrder,
  markDeptPurchaseOrdered,
  receiveDeptPurchaseOrder,
  submitDeptPurchaseOrder,
} from "@/server/actions/dept-purchase";
import { DEPT } from "./meta";

export interface ActionLine {
  id: string;
  itemName: string;
  unit: string;
  quantity: string;
  /** Still to arrive: approved − received. */
  remaining: string;
  rate: string | null;
}

interface Props {
  id: string;
  department: StoreDepartment;
  status: DeptPurchaseStatus;
  /** ADMIN / MANAGER — the only people who may approve or reject. */
  canDecide: boolean;
  supplierName: string;
  supplierPhone: string;
  expectedAt: string;
  lines: ActionLine[];
}

const FIELD = "h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]";
const PANEL = "grid gap-3 rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card";
const REASON_INPUT = "h-8 w-64 text-[12.5px]";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(fn: () => Promise<ActionResult>, success: string, after?: () => void) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(success);
        after?.();
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }
  return { pending, run };
}

export function PurchaseActions(p: Props) {
  const { pending, run } = useRun();
  const base = `${DEPT[p.department].base}/purchase/${p.id}`;
  const cancellable = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED"].includes(p.status);
  const receivable = ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"].includes(p.status);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {p.status === "DRAFT" && (
          <>
            <Button disabled={pending} onClick={() => run(() => submitDeptPurchaseOrder(p.id), "Sent for approval")}>
              Send for approval
            </Button>
            <Link href={`${base}/edit`}>
              <Button variant="outline">Edit</Button>
            </Link>
          </>
        )}
        <Link href={`${base}/print`}>
          <Button variant="outline">Print PO</Button>
        </Link>
        {cancellable && (
          <span className="ml-auto">
            <InlineReasonForm
              action={(r) => cancelDeptPurchaseOrder(p.id, r)}
              submitLabel="Cancel PO"
              successMessage="Cancelled"
              placeholder="Why cancel it?"
              inputClassName={REASON_INPUT}
            />
          </span>
        )}
        {p.status === "PARTIALLY_RECEIVED" && (
          <span className="ml-auto">
            <InlineReasonForm
              action={(r) => closeDeptPurchaseOrderShort(p.id, r)}
              submitLabel="Close short"
              successMessage="Closed — the rest is no longer expected"
              placeholder="Why won't the rest come?"
              inputClassName={REASON_INPUT}
            />
          </span>
        )}
      </div>

      {p.status === "PENDING_APPROVAL" &&
        (p.canDecide ? (
          <DecidePanel {...p} />
        ) : (
          <p className="text-[12.5px] text-ik-ink-3">Waiting for an admin or manager to approve.</p>
        ))}
      {p.status === "APPROVED" && <OrderedPanel {...p} />}
      {receivable && <ReceivePanel {...p} />}
    </div>
  );
}

function DecidePanel({ id, lines }: Props) {
  const { pending, run } = useRun();
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, l.quantity])));
  const [note, setNote] = useState("");
  return (
    <section className={PANEL}>
      <div className="text-[12px] font-medium text-ik-ink-2">Approve or reject</div>
      <div className="grid gap-2">
        {lines.map((l) => (
          <div key={l.id} className="grid items-center gap-2 sm:grid-cols-[1fr,140px]">
            <Label htmlFor={`approve-${l.id}`} className="text-[13px]">
              {l.itemName} <span className="text-ik-ink-3">— asked {l.quantity} {l.unit}</span>
            </Label>
            <Input
              id={`approve-${l.id}`}
              type="number"
              inputMode="decimal"
              min="0"
              max={l.quantity}
              step="any"
              value={qty[l.id] ?? ""}
              onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <Textarea rows={2} maxLength={1000} placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () =>
                decideDeptPurchaseOrder(id, {
                  decision: "APPROVE",
                  note,
                  lines: lines.map((l) => ({ lineId: l.id, approvedQty: qty[l.id] ?? "" })),
                }),
              "Approved",
            )
          }
        >
          Approve
        </Button>
        <Button
          variant="outline"
          disabled={pending || !note.trim()}
          onClick={() => run(() => decideDeptPurchaseOrder(id, { decision: "REJECT", note }), "Rejected")}
        >
          Reject
        </Button>
      </div>
      <p className="text-[11.5px] text-ik-ink-3">Lower a quantity to cut it; 0 drops the line.</p>
    </section>
  );
}

function OrderedPanel(p: Props) {
  const { pending, run } = useRun();
  const [supplierName, setSupplierName] = useState(p.supplierName);
  const [supplierPhone, setSupplierPhone] = useState(p.supplierPhone);
  const [expectedAt, setExpectedAt] = useState(p.expectedAt);
  return (
    <section className={PANEL}>
      <div className="text-[12px] font-medium text-ik-ink-2">Placed the order with the supplier?</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="po-supplier">Supplier</Label>
          <Input id="po-supplier" maxLength={160} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="po-phone">Phone</Label>
          <Input id="po-phone" maxLength={20} inputMode="tel" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="po-expected">Expected on</Label>
          <input id="po-expected" type="date" className={FIELD} value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
        </div>
      </div>
      <div>
        <Button
          disabled={pending}
          onClick={() => run(() => markDeptPurchaseOrdered(p.id, { supplierName, supplierPhone, expectedAt }), "Marked as ordered")}
        >
          Mark ordered
        </Button>
      </div>
    </section>
  );
}

function ReceivePanel({ id, lines }: Props) {
  const { pending, run } = useRun();
  const open = lines.filter((l) => Number(l.remaining) > 0);
  const [receivedAt, setReceivedAt] = useState(nowLocalInput);
  const [billNo, setBillNo] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const reset = () => {
    setQty({});
    setCost({});
    setBillNo("");
    setNote("");
  };

  function submit() {
    const rows = open
      .filter((l) => (qty[l.id] ?? "").trim())
      .map((l) => ({ lineId: l.id, quantity: qty[l.id].trim(), costPerUnit: (cost[l.id] ?? "").trim() || null }));
    if (rows.length === 0) {
      toast.error("Enter the quantity that arrived on at least one line");
      return;
    }
    run(
      () => receiveDeptPurchaseOrder(id, { receivedAt, supplierBillNo: billNo, note, lines: rows }),
      "Goods received into the store",
      reset,
    );
  }

  if (open.length === 0) return null;
  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-ik-ink-2">Receive goods</div>
        <Button size="sm" variant="outline" onClick={() => setQty(Object.fromEntries(open.map((l) => [l.id, l.remaining])))}>
          Fill all remaining
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="rcv-at">Received at</Label>
          <input id="rcv-at" type="datetime-local" className={FIELD} value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rcv-bill">Supplier bill no</Label>
          <Input id="rcv-bill" maxLength={60} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rcv-note">Note</Label>
          <Input id="rcv-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-2">
        {open.map((l) => (
          <div key={l.id} className="grid items-end gap-2 sm:grid-cols-[1fr,130px,130px]">
            <div className="text-[13px]">
              {l.itemName} <span className="text-ik-ink-3">— {l.remaining} {l.unit} to come</span>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`rcv-q-${l.id}`} className="text-[11.5px]">Arrived ({l.unit})</Label>
              <Input
                id={`rcv-q-${l.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                max={l.remaining}
                step="any"
                value={qty[l.id] ?? ""}
                onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`rcv-c-${l.id}`} className="text-[11.5px]">Cost / unit (₹)</Label>
              <Input
                id={`rcv-c-${l.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder={l.rate ?? "optional"}
                value={cost[l.id] ?? ""}
                onChange={(e) => setCost((c) => ({ ...c, [l.id]: e.target.value }))}
              />
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button disabled={pending} onClick={submit}>
          {pending ? "Saving…" : "Record receipt"}
        </Button>
      </div>
    </section>
  );
}

/** For the print view. */
export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      Print
    </Button>
  );
}
