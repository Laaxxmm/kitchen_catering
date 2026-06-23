"use client";

import Link from "next/link";
import { ChefRequisitionStatus, PurchaseRequisitionStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { WorkTabs } from "@/components/ik/dashboard/WorkTabs";
import { formatIST } from "@/lib/time";

export interface StoreReq {
  id: string;
  requisitionNo: string;
  status: ChefRequisitionStatus;
  orderCode: string;
  customerName: string;
  eventDate: string;
  lines: number;
}
export interface StorePR {
  id: string;
  prNo: string;
  status: PurchaseRequisitionStatus;
  requestedBy: string;
  lines: number;
}

const PR_LABEL: Partial<Record<PurchaseRequisitionStatus, string>> = {
  DRAFT: "Draft — submit it",
  PENDING_APPROVAL: "Waiting on approval",
  APPROVED: "Approved — make the PO",
  ISSUED: "Turned into a PO",
  REJECTED: "Rejected",
};

/**
 * Store keeper's board: chef ingredient requests to fulfil, and the stock
 * (purchase) requests they've raised. Issuing is line-by-line, so each
 * request opens its fulfilment page; the board keeps everything one tap
 * away and grouped by what needs doing.
 */
export function StoreBoard({ chefReqs, prs }: { chefReqs: StoreReq[]; prs: StorePR[] }) {
  const tabs = [
    { key: "fulfil", label: "Chef requests", hint: "Issue from stock", count: chefReqs.length },
    { key: "stock", label: "My stock requests", hint: "Buy more", count: prs.length },
  ];

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Link href="/procurement/purchase-requisitions/new">
          <Button size="sm" variant="outline">Raise stock request</Button>
        </Link>
      </div>
      <WorkTabs tabs={tabs} emptyHint="Nothing in {tab} right now.">
        {(active) =>
          active === "fulfil" ? (
            <ul className="grid gap-2.5">
              {chefReqs.map((r) => (
                <li key={r.id} className="rounded-md border border-amber bg-amber-wash p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-[12.5px] text-brand-700">{r.requisitionNo}</span>
                    <span className="text-[11.5px] text-ik-ink-3">{formatIST(new Date(r.eventDate), "EEE d MMM HH:mm")}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-ik-ink">
                    <strong>{r.customerName}</strong> <span className="text-ik-ink-3">· order {r.orderCode}</span>
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
              ))}
            </ul>
          ) : (
            <ul className="grid gap-2.5">
              {prs.map((p) => (
                <li key={p.id} className="rounded-md border border-ik-rule bg-ik-card p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-[12.5px] text-brand-700">{p.prNo}</span>
                    <span className="text-[11.5px] text-ik-ink-3">{p.lines} {p.lines === 1 ? "item" : "items"}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-ik-ink-2">{PR_LABEL[p.status] ?? p.status}</div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Link href={`/procurement/purchase-requisitions/${p.id}`} className="text-[11.5px] text-brand hover:underline">Open</Link>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </WorkTabs>
    </div>
  );
}
