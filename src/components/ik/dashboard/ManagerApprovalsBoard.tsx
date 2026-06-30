"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WorkTabs } from "@/components/ik/dashboard/WorkTabs";
import { formatIST } from "@/lib/time";
import { formatINR } from "@/lib/money";
import { isNextNavigationError } from "@/lib/next-error";
import { managerApproveChefSuggestion } from "@/server/actions/orders";
import { approveVendorPO } from "@/server/actions/procurement";

export interface OrderChange {
  id: string;
  code: string;
  customerName: string;
  eventDate: string;
  note: string | null;
}
export interface PurchaseOrder {
  id: string;
  poNo: string;
  vendor: string;
  grandTotal: string;
}

interface Props {
  orderChanges: OrderChange[];
  purchaseOrders: PurchaseOrder[];
}

/**
 * Manager's approvals in one place — chef-proposed order changes and
 * purchase orders — each with approve/reject inline. No drilling into detail
 * pages to sign off routine items.
 */
export function ManagerApprovalsBoard({ orderChanges, purchaseOrders }: Props) {
  const total = orderChanges.length + purchaseOrders.length;
  if (total === 0) return null;

  const tabs = [
    { key: "orders", label: "Order changes", hint: "Chef suggestions", count: orderChanges.length },
    { key: "po", label: "Purchase orders", hint: "Sign off spend", count: purchaseOrders.length },
  ];

  return (
    <div>
      <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Needs your approval</h2>
      <WorkTabs tabs={tabs} emptyHint="Nothing in {tab} right now.">
        {(active) => {
          if (active === "orders") {
            return (
              <ul className="grid gap-2.5">
                {orderChanges.map((o) => <OrderChangeCard key={o.id} change={o} />)}
              </ul>
            );
          }
          return (
            <ul className="grid gap-2.5">
              {purchaseOrders.map((p) => <PurchaseOrderCard key={p.id} po={p} />)}
            </ul>
          );
        }}
      </WorkTabs>
    </div>
  );
}

function useApprove() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(fn: () => Promise<unknown>, successMsg: string, after?: () => void) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(successMsg);
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

function OrderChangeCard({ change }: { change: OrderChange }) {
  const { pending, run } = useApprove();
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="rounded-md border border-amber bg-amber-wash p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-brand-700">{change.code}</span>
        <span className="text-[11.5px] text-ik-ink-3">{formatIST(new Date(change.eventDate), "EEE d MMM HH:mm")}</span>
      </div>
      <div className="mt-1 text-[13px] text-ik-ink"><strong>{change.customerName}</strong></div>
      {change.note && <div className="mt-1 rounded bg-ik-card p-2 text-[12px] text-ik-ink-2 ring-1 ring-ik-rule">{change.note}</div>}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending}
          onClick={() => run(() => managerApproveChefSuggestion(change.id, { decision: "APPROVED", note: note || undefined }), "Approved — order continues")}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowReject((v) => !v)}>Reject</Button>
        <Link href={`/orders/${change.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Open</Link>
      </div>
      {showReject && (
        <div className="mt-2 grid gap-2 rounded-md border border-ik-rule bg-ik-card p-2.5">
          <Textarea rows={2} placeholder="Reason for rejecting" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pending || !note.trim()}
              onClick={() => run(() => managerApproveChefSuggestion(change.id, { decision: "REJECTED", note }), "Rejected")}>
              Confirm reject
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowReject(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function PurchaseOrderCard({ po }: { po: PurchaseOrder }) {
  const { pending, run } = useApprove();
  return (
    <li className="rounded-md border border-brand-200 bg-brand-50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-brand-700">{po.poNo}</span>
        <span className="font-mono text-[12.5px] text-ik-ink">{formatINR(po.grandTotal)}</span>
      </div>
      <div className="mt-1 text-[13px] text-ik-ink"><strong>{po.vendor}</strong></div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending}
          onClick={() => run(() => approveVendorPO(po.id), "Approved")}>Approve</Button>
        <Link href={`/procurement/purchase-orders/${po.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Open</Link>
      </div>
    </li>
  );
}
