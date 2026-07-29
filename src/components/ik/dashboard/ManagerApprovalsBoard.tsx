"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OrderChannel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WorkTabs } from "@/components/ik/dashboard/WorkTabs";
import { CappedList } from "@/components/ik/dashboard/CappedList";
import { formatIST } from "@/lib/time";
import { formatINR } from "@/lib/money";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";
import { adminApproveOrder, managerApproveChefSuggestion } from "@/server/actions/orders";
import { approveVendorPO } from "@/server/actions/procurement";
import { approveVendor } from "@/server/actions/vendors";

export interface OrderToApprove {
  id: string;
  code: string;
  customerName: string;
  eventDate: string;
  channel: OrderChannel;
  headcount: number;
  contractValue: string;
}
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
  /** Manager step already recorded — only the admin's signature is left. */
  awaitingAdmin: boolean;
}
export interface PendingVendor {
  id: string;
  name: string;
  code: string;
  /** ISO createdAt. */
  createdAt: string;
}

interface Props {
  ordersToApprove: OrderToApprove[];
  orderChanges: OrderChange[];
  purchaseOrders: PurchaseOrder[];
  /** Store-added suppliers awaiting sign-off — every PO on them is blocked. */
  pendingVendors?: PendingVendor[];
  viewerIsAdmin?: boolean;
}

const CHANNEL_LABEL: Record<OrderChannel, string> = {
  BANQUET: "Banquet",
  BUFFET: "Buffet",
  ODC: "ODC",
  PACKET: "Packed",
  COUNTER_SALE: "Counter sale",
  ROOM_SERVICE: "Room service",
  ALACARTE: "À la carte",
  MANAGEMENT: "Management",
};

/**
 * Manager's approvals in one place — orders awaiting commercial sign-off,
 * chef-proposed order changes, and purchase orders — each with approve/reject
 * inline. Within a tab the cards lay out in a wrapping grid, so a long queue
 * grows downwards and stays on screen. Nothing here gets missed: the order
 * gate sits first since the kitchen waits on it.
 */
export function ManagerApprovalsBoard({ ordersToApprove, orderChanges, purchaseOrders, pendingVendors = [], viewerIsAdmin = false }: Props) {
  const total =
    ordersToApprove.length + orderChanges.length + purchaseOrders.length + pendingVendors.length;
  if (total === 0) return null;

  const tabs = [
    { key: "orders", label: "Orders to approve", hint: "Commercial sign-off", count: ordersToApprove.length },
    { key: "changes", label: "Order changes", hint: "Chef suggestions", count: orderChanges.length },
    { key: "po", label: "Purchase orders", hint: "Sign off spend", count: purchaseOrders.length },
    { key: "vendors", label: "New suppliers", hint: "Approve to unblock POs", count: pendingVendors.length },
  ];

  // Soonest event first (the kitchen waits on these); POs keep their order.
  const eventTime = (d: string) => new Date(d).getTime();
  const ordersSorted = [...ordersToApprove].sort((a, b) => eventTime(a.eventDate) - eventTime(b.eventDate));
  const changesSorted = [...orderChanges].sort((a, b) => eventTime(a.eventDate) - eventTime(b.eventDate));

  return (
    <div>
      <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Needs your approval</h2>
      <WorkTabs tabs={tabs} emptyHint="Nothing in {tab} right now.">
        {(active) => {
          if (active === "orders") {
            return (
              <CappedList items={ordersSorted} className={CARD_GRID} keyOf={(o) => o.id}>
                {(o) => <OrderApprovalCard order={o} />}
              </CappedList>
            );
          }
          if (active === "changes") {
            return (
              <CappedList items={changesSorted} className={CARD_GRID} keyOf={(o) => o.id}>
                {(o) => <OrderChangeCard change={o} />}
              </CappedList>
            );
          }
          if (active === "vendors") {
            return (
              <CappedList items={pendingVendors} className={CARD_GRID} keyOf={(v) => v.id}>
                {(v) => <VendorApprovalCard vendor={v} />}
              </CappedList>
            );
          }
          return (
            <CappedList items={purchaseOrders} className={CARD_GRID} keyOf={(p) => p.id}>
              {(p) => <PurchaseOrderCard po={p} viewerIsAdmin={viewerIsAdmin} />}
            </CappedList>
          );
        }}
      </WorkTabs>
    </div>
  );
}

// Wrapping card grid — same language as the store / accounts boards. This
// was a fixed-width horizontal scroll row, but a long queue then sized the
// dashboard's auto grid track to its own max-content width (7 × 290px), so
// the whole page overflowed sideways instead of the row scrolling on its
// own. Wrapping means the queue can't outgrow the viewport, and the manager
// never has to scroll sideways to find an approval.
const CARD_GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";

function useApprove() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(fn: () => Promise<unknown>, successMsg: string, after?: () => void) {
    startTransition(async () => {
      try {
        const res = (await fn()) as ActionResult | undefined;
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
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

const CARD = "flex flex-col rounded-md p-3";

function OrderApprovalCard({ order }: { order: OrderToApprove }) {
  const { pending, run } = useApprove();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");

  return (
    <li className={CARD + " border border-alert/40 bg-alert-wash/40"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-brand-700">{order.code}</span>
        <span className="font-mono text-[12.5px] text-ik-ink">{formatINR(order.contractValue)}</span>
      </div>
      <div className="mt-1 text-[13px] text-ik-ink"><strong>{order.customerName}</strong></div>
      <div className="mt-0.5 text-[11.5px] text-ik-ink-2">
        {CHANNEL_LABEL[order.channel]} · {order.headcount} pax · {formatIST(new Date(order.eventDate), "EEE d MMM")}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => setMode((m) => (m === "approve" ? null : "approve"))}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setMode((m) => (m === "reject" ? null : "reject"))}>
          Reject
        </Button>
        <Link href={`/orders/${order.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Open</Link>
      </div>
      {mode && (
        <div className="mt-2 grid gap-2 rounded-md border border-ik-rule bg-ik-card p-2.5">
          <Textarea
            rows={2}
            placeholder={mode === "approve" ? "Note — why you're approving (required)" : "Reason for rejecting (required)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "approve" ? "default" : "outline"}
              disabled={pending || !note.trim()}
              onClick={() =>
                run(
                  () => adminApproveOrder(order.id, { decision: mode === "approve" ? "APPROVED" : "REJECTED", note }),
                  mode === "approve" ? "Approved — order goes to the chef" : "Rejected",
                  () => { setMode(null); setNote(""); },
                )
              }
            >
              {mode === "approve" ? "Confirm approve" : "Confirm reject"}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setMode(null); setNote(""); }}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function OrderChangeCard({ change }: { change: OrderChange }) {
  const { pending, run } = useApprove();
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className={CARD + " border border-amber bg-amber-wash"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-brand-700">{change.code}</span>
        <span className="text-[11.5px] text-ik-ink-3">{formatIST(new Date(change.eventDate), "EEE d MMM HH:mm")}</span>
      </div>
      <div className="mt-1 text-[13px] text-ik-ink"><strong>{change.customerName}</strong></div>
      {change.note && <div className="mt-1 rounded bg-ik-card p-2 text-[12px] text-ik-ink-2 ring-1 ring-ik-rule">{change.note}</div>}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending}
          onClick={() => run(() => managerApproveChefSuggestion(change.id, { decision: "APPROVED", note: note || undefined }), "Approved — back to the chef to accept")}>
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

function PurchaseOrderCard({ po, viewerIsAdmin }: { po: PurchaseOrder; viewerIsAdmin: boolean }) {
  const { pending, run } = useApprove();
  // Manager already signed; only the admin can act now — showing the
  // manager an Approve button here would just earn them a refusal toast.
  const viewerCanAct = !po.awaitingAdmin || viewerIsAdmin;
  return (
    <li className={CARD + " border border-brand-200 bg-brand-50"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-brand-700">{po.poNo}</span>
        <span className="font-mono text-[12.5px] text-ik-ink">{formatINR(po.grandTotal)}</span>
      </div>
      <div className="mt-1 text-[13px] text-ik-ink"><strong>{po.vendor}</strong></div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {viewerCanAct ? (
          <Button size="sm" disabled={pending}
            onClick={() => run(() => approveVendorPO(po.id), "Approved")}>Approve</Button>
        ) : (
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-amber-700">
            Manager approved · awaiting Admin
          </span>
        )}
        <Link href={`/procurement/purchase-orders/${po.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Open</Link>
      </div>
    </li>
  );
}

/**
 * A store-added supplier awaiting sign-off. Until approved, every PO on
 * them refuses to submit — so the approve action lives right here on the
 * board instead of only on the vendor detail page, where nobody looked.
 */
function VendorApprovalCard({ vendor }: { vendor: PendingVendor }) {
  const { pending, run } = useApprove();
  return (
    <li className={CARD + " border border-amber/45 bg-amber-wash/40"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-brand-700">{vendor.code}</span>
        <span className="text-[11.5px] text-ik-ink-3">added {formatIST(new Date(vendor.createdAt), "d MMM")}</span>
      </div>
      <div className="mt-1 text-[13px] text-ik-ink"><strong>{vendor.name}</strong></div>
      <div className="mt-0.5 text-[11.5px] text-ik-ink-2">
        New supplier from the store — their purchase orders are blocked until you approve.
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => approveVendor(vendor.id), `${vendor.name} approved — their POs can now be submitted`)}
        >
          Approve
        </Button>
        <Link href={`/procurement/vendors/${vendor.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Review</Link>
      </div>
    </li>
  );
}
