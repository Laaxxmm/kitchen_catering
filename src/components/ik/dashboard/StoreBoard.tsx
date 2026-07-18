"use client";

import Link from "next/link";
import { BanquetRequisitionStatus, ChefRequisitionStatus, VendorPOStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { WorkTabs } from "@/components/ik/dashboard/WorkTabs";
import { CappedList } from "@/components/ik/dashboard/CappedList";
import { formatIST } from "@/lib/time";
import { formatINRWhole } from "@/lib/money";

export interface StoreReq {
  id: string;
  requisitionNo: string;
  status: ChefRequisitionStatus;
  /** null for a standalone (order-less) kitchen stock request. */
  orderCode: string | null;
  customerName: string;
  eventDate: string | null;
  lines: number;
}
export interface StoreFnbReq {
  id: string;
  requisitionNo: string;
  status: BanquetRequisitionStatus;
  requestedBy: string;
  /** null when the request isn't tied to an order. */
  orderCode: string | null;
  eventDate: string | null;
  lines: number;
}
export interface StorePO {
  id: string;
  poNo: string;
  status: VendorPOStatus;
  vendor: string;
  total: string;
}

// What the store should DO next for each PO status.
const PO_LABEL: Partial<Record<VendorPOStatus, string>> = {
  DRAFT: "Draft — submit it for approval",
  PENDING_APPROVAL: "Waiting on manager / admin approval",
  APPROVED: "Approved — send to vendor & record the GRN",
  SENT: "Sent to vendor — record the GRN when goods arrive",
  PARTIALLY_RECEIVED: "Partly received — record the rest",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

// Statuses that need the store to act now (highlighted).
const PO_NEEDS_ACTION = new Set<VendorPOStatus>([
  VendorPOStatus.DRAFT,
  VendorPOStatus.APPROVED,
  VendorPOStatus.SENT,
  VendorPOStatus.PARTIALLY_RECEIVED,
]);

/**
 * Store keeper's board: chef ingredient requests and F&B banquet-store
 * requests to fulfil, plus the purchase orders they've raised for
 * shortfalls — submit, watch for approval, then send to the vendor +
 * record the GRN.
 */
export function StoreBoard({
  chefReqs,
  fnbReqs,
  pos,
}: {
  chefReqs: StoreReq[];
  fnbReqs: StoreFnbReq[];
  pos: StorePO[];
}) {
  const tabs = [
    { key: "fulfil", label: "Chef requests", hint: "Issue from stock", count: chefReqs.length },
    { key: "fnb", label: "F&B requests", hint: "Cutlery & disposables", count: fnbReqs.length },
    { key: "stock", label: "My purchase orders", hint: "Buy & receive", count: pos.length },
  ];

  // Newest request first — the lists arrive createdAt-desc from the server,
  // so keep that order (an event-date sort buried brand-new general requests
  // that have no event date). POs still surface action-needed first.
  const chefSorted = chefReqs;
  const fnbSorted = fnbReqs;
  const posSorted = [...pos].sort(
    (a, b) => Number(PO_NEEDS_ACTION.has(b.status)) - Number(PO_NEEDS_ACTION.has(a.status)),
  );

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Link href="/procurement/purchase-orders/new">
          <Button size="sm" variant="outline">New purchase order</Button>
        </Link>
      </div>
      <WorkTabs tabs={tabs} emptyHint="Nothing in {tab} right now.">
        {(active) =>
          active === "fulfil" ? (
            <CappedList items={chefSorted} className="grid gap-2.5" keyOf={(r) => r.id}>
              {(r) => (
                <li key={r.id} className="rounded-md border border-amber bg-amber-wash p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-[12.5px] text-brand-700">{r.requisitionNo}</span>
                    {r.eventDate && (
                      <span className="text-[11.5px] text-ik-ink-3">{formatIST(new Date(r.eventDate), "EEE d MMM HH:mm")}</span>
                    )}
                  </div>
                  <div className="mt-1 text-[13px] text-ik-ink">
                    <strong>{r.customerName}</strong>
                    {r.orderCode
                      ? <span className="text-ik-ink-3"> · order {r.orderCode}</span>
                      : <span className="text-ik-ink-3"> · general kitchen request</span>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ik-ink-2">
                    {r.lines} {r.lines === 1 ? "line" : "lines"} · {r.status === "PARTIALLY_ISSUED" ? "partly issued" : "to issue"}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Link href={`/requisitions/${r.id}`}>
                      <Button size="sm">Open to issue</Button>
                    </Link>
                  </div>
                </li>
              )}
            </CappedList>
          ) : active === "fnb" ? (
            <CappedList items={fnbSorted} className="grid gap-2.5" keyOf={(r) => r.id}>
              {(r) => (
                <li key={r.id} className="rounded-md border border-amber bg-amber-wash p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-[12.5px] text-brand-700">{r.requisitionNo}</span>
                    {r.eventDate && (
                      <span className="text-[11.5px] text-ik-ink-3">{formatIST(new Date(r.eventDate), "EEE d MMM HH:mm")}</span>
                    )}
                  </div>
                  <div className="mt-1 text-[13px] text-ik-ink">
                    <strong>{r.requestedBy}</strong>
                    {r.orderCode
                      ? <span className="text-ik-ink-3"> · order {r.orderCode}</span>
                      : <span className="text-ik-ink-3"> · banquet store request</span>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ik-ink-2">
                    {r.lines} {r.lines === 1 ? "line" : "lines"} · {r.status === "PARTIALLY_ISSUED" ? "partly issued" : "to issue"}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Link href={`/banquet/requisitions/${r.id}`}>
                      <Button size="sm">Open to issue</Button>
                    </Link>
                  </div>
                </li>
              )}
            </CappedList>
          ) : (
            <CappedList items={posSorted} className="grid gap-2.5" keyOf={(p) => p.id}>
              {(p) => {
                const act = PO_NEEDS_ACTION.has(p.status);
                return (
                  <li
                    key={p.id}
                    className={
                      "rounded-md border p-3 " +
                      (act ? "border-amber bg-amber-wash" : "border-ik-rule bg-ik-card")
                    }
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-[12.5px] text-brand-700">{p.poNo}</span>
                      <span className="font-mono text-[12px] text-ik-ink">{formatINRWhole(p.total)}</span>
                    </div>
                    <div className="mt-1 text-[13px] text-ik-ink">
                      <strong>{p.vendor}</strong>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ik-ink-2">{PO_LABEL[p.status] ?? p.status}</div>
                    <div className="mt-2.5">
                      <Link href={`/procurement/purchase-orders/${p.id}`}>
                        <Button size="sm" variant={act ? "default" : "outline"}>
                          {act ? "Open to act" : "Open"}
                        </Button>
                      </Link>
                    </div>
                  </li>
                );
              }}
            </CappedList>
          )
        }
      </WorkTabs>
    </div>
  );
}
