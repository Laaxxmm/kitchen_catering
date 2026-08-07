"use client";

import Link from "next/link";
import { BanquetRequisitionStatus, ChefRequisitionStatus, VendorPOStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { WorkTabs } from "@/components/ik/dashboard/WorkTabs";
import { CappedList } from "@/components/ik/dashboard/CappedList";
import { BoardHeader } from "@/components/ik/dashboard/BoardHeader";
import { eventPriority } from "@/components/ik/EventDateBadge";
import { Countdown } from "@/components/ik/dashboard/Countdown";
import { BoardPoller } from "@/components/ik/dashboard/BoardPoller";
import {
  CriticalRevisionModal,
  RevisedBadge,
  RevisedOrdersPanel,
  type RevisedOrderCard,
} from "@/components/ik/dashboard/RevisedOrdersPanel";
import { formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";
import type { RevisionBand } from "@/lib/order-revision";

/** Left accent + border keyed to urgency — shared card language with the
 *  /requisitions grid. `days === null` is an order-less request (no deadline). */
function accent(days: number | null): { bar: string; border: string } {
  if (days === null) return { bar: "bg-ik-rule-strong", border: "border-ik-rule" };
  if (days <= 0) return { bar: "bg-alert", border: "border-alert/35" };
  if (days <= 3) return { bar: "bg-amber", border: "border-amber/45" };
  return { bar: "bg-ik-rule-strong", border: "border-ik-rule" };
}

export interface StoreReq {
  id: string;
  requisitionNo: string;
  status: ChefRequisitionStatus;
  /** null for a standalone (order-less) kitchen stock request. */
  orderCode: string | null;
  customerName: string;
  eventDate: string | null;
  deliveryWindowStart?: string | null;
  deliveryWindowEnd?: string | null;
  /** ISO createdAt — the "raised" date shown for order-less requests. */
  createdAt: string;
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
  /** ISO createdAt — the "raised" date shown for order-less requests. */
  createdAt: string;
  lines: number;
}
export interface StorePO {
  id: string;
  poNo: string;
  status: VendorPOStatus;
  vendor: string;
  total: string;
}
/** A kitchen return the chef has declared and the store hasn't counted in
 *  yet. Real work on this bench: someone is walking stock to the counter,
 *  and neither the stock nor the order's cost moves until it's confirmed. */
export interface StoreReturnDeclaration {
  id: string;
  /** ISO — the date the chef says it's coming back. */
  declaredAt: string;
  declaredBy: string;
  orderCode: string | null;
  lines: number;
  /** "2 kg Paneer · 5 kg Onion" — enough to recognise the trolley. */
  summary: string;
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
  revised,
  returnDeclarations,
}: {
  chefReqs: StoreReq[];
  fnbReqs: StoreFnbReq[];
  pos: StorePO[];
  /** Orders a manager changed that the store hasn't re-checked yet. */
  revised: RevisedOrderCard[];
  /** Kitchen returns the chef has declared, waiting to be counted in. */
  returnDeclarations: StoreReturnDeclaration[];
}) {
  // A changed order outranks every other job on this bench — issuing to a
  // stale requisition is the expensive mistake — so it opens first.
  const tabs = [
    { key: "revised", label: "Revised orders", hint: "Changed — re-check", count: revised.length },
    { key: "fulfil", label: "Chef requests", hint: "Issue from stock", count: chefReqs.length },
    { key: "fnb", label: "F&B requests", hint: "Cutlery & disposables", count: fnbReqs.length },
    {
      key: "returns",
      label: "Kitchen returns",
      hint: "Count in & confirm",
      count: returnDeclarations.length,
    },
    { key: "stock", label: "My purchase orders", hint: "Buy & receive", count: pos.length },
  ];

  // Two ways a card here belongs to a revised order: the store's own stale
  // documents come back by id, and anything raised against the order (the
  // chef's requisitions included) matches on the order code.
  const bandByOrderCode = new Map(revised.map((r) => [r.code, r.band] as const));
  const bandByDocId = new Map(
    revised.flatMap((r) => r.documents.map((d) => [d.id, r.band] as const)),
  );
  const bandFor = (docId: string, orderCode: string | null) =>
    bandByDocId.get(docId) ?? (orderCode ? bandByOrderCode.get(orderCode) : undefined);

  // Urgent first: revised orders above everything, then order-linked requests
  // by soonest event date (overdue floats up), then order-less general
  // requests newest-first — so a dated job due soon always sits above undated
  // general stock-ups. POs surface action-needed first.
  const byUrgency = <T extends { id: string; orderCode: string | null; eventDate: string | null; createdAt: string }>(
    a: T,
    b: T,
  ) => {
    const rev = Number(bandFor(b.id, b.orderCode) != null) - Number(bandFor(a.id, a.orderCode) != null);
    if (rev !== 0) return rev;
    if (a.eventDate && b.eventDate) return a.eventDate.localeCompare(b.eventDate);
    if (a.eventDate) return -1;
    if (b.eventDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  };
  const chefSorted = [...chefReqs].sort(byUrgency);
  const fnbSorted = [...fnbReqs].sort(byUrgency);
  const posSorted = [...pos].sort(
    (a, b) =>
      Number(bandByDocId.has(b.id)) - Number(bandByDocId.has(a.id)) ||
      Number(PO_NEEDS_ACTION.has(b.status)) - Number(PO_NEEDS_ACTION.has(a.status)),
  );

  const total = chefReqs.length + fnbReqs.length + pos.length + returnDeclarations.length;

  return (
    <div>
      <CriticalRevisionModal orders={revised} scope="store" />
      <BoardPoller />
      <BoardHeader
        total={total}
        unit="jobs on your bench"
        segments={[
          { label: "Chef requests", value: chefReqs.length, tone: "approval" },
          { label: "F&B requests", value: fnbReqs.length, tone: "production" },
          { label: "Kitchen returns", value: returnDeclarations.length, tone: "low" },
          { label: "Purchase orders", value: pos.length, tone: "done" },
        ]}
      />
      <div className="mb-3 flex justify-end">
        <Link href="/procurement/purchase-orders/new">
          <Button size="sm" variant="outline">New purchase order</Button>
        </Link>
      </div>
      <WorkTabs tabs={tabs} emptyHint="Nothing in {tab} right now.">
        {(active) =>
          active === "revised" ? (
            <RevisedOrdersPanel orders={revised} scope="store" />
          ) : active === "fulfil" ? (
            <CappedList items={chefSorted} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" keyOf={(r) => r.id}>
              {(r) => (
                <ReqCard
                  key={r.id}
                  href={`/requisitions/${r.id}`}
                  reqNo={r.requisitionNo}
                  title={r.customerName}
                  sub={`${r.orderCode ? `order ${r.orderCode} · ` : "general · "}${r.lines} ${r.lines === 1 ? "line" : "lines"} · ${r.status === "PARTIALLY_ISSUED" ? "part issued" : "to issue"}`}
                  eventDate={r.eventDate}
                  deliveryWindow={r.deliveryWindowStart && r.deliveryWindowEnd ? { start: r.deliveryWindowStart, end: r.deliveryWindowEnd } : null}
                  createdAt={r.createdAt}
                  revisedBand={bandFor(r.id, r.orderCode)}
                />
              )}
            </CappedList>
          ) : active === "fnb" ? (
            <CappedList items={fnbSorted} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" keyOf={(r) => r.id}>
              {(r) => (
                <ReqCard
                  key={r.id}
                  href={`/banquet/requisitions/${r.id}`}
                  reqNo={r.requisitionNo}
                  title={r.requestedBy}
                  sub={`${r.orderCode ? `order ${r.orderCode} · ` : "banquet · "}${r.lines} ${r.lines === 1 ? "line" : "lines"} · ${r.status === "PARTIALLY_ISSUED" ? "part issued" : "to issue"}`}
                  eventDate={r.eventDate}
                  createdAt={r.createdAt}
                  revisedBand={bandFor(r.id, r.orderCode)}
                />
              )}
            </CappedList>
          ) : active === "returns" ? (
            <CappedList
              items={returnDeclarations}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              keyOf={(d) => d.id}
            >
              {(d) => (
                <li
                  key={d.id}
                  className={
                    "relative flex flex-col overflow-hidden rounded-lg border border-amber/45 bg-ik-card transition " +
                    "hover:shadow-[0_3px_18px_rgba(20,25,20,0.07)]"
                  }
                >
                  <span className="absolute inset-y-0 left-0 w-1 bg-amber" aria-hidden />
                  <div className="flex h-full flex-col gap-2 p-4 pl-5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[12px] text-ik-ink-3">
                        {d.orderCode ?? "no order"}
                      </span>
                      <span className="rounded-full bg-amber-wash px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-700">
                        WAITING
                      </span>
                    </div>
                    <div className="text-[20px] font-bold leading-none tracking-tight text-ik-ink">
                      {formatIST(new Date(d.declaredAt), "EEE d MMM")}
                    </div>
                    <div className="truncate text-[13px] font-medium text-ik-ink">
                      {d.declaredBy} is sending {d.lines} {d.lines === 1 ? "item" : "items"} back
                    </div>
                    <div className="text-[12px] text-ik-ink-3">{d.summary}</div>
                    <Link href={`/inventory/returns/${d.id}`} className="mt-auto pt-1">
                      <Button className="h-10 w-full">Count in & confirm →</Button>
                    </Link>
                  </div>
                </li>
              )}
            </CappedList>
          ) : (
            <CappedList items={posSorted} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" keyOf={(p) => p.id}>
              {(p) => {
                const act = PO_NEEDS_ACTION.has(p.status);
                const band = bandByDocId.get(p.id);
                // Border + rail only here — the card keeps its own surface, so
                // the wash stays exclusive to the revised panel and the modal.
                const a = band
                  ? { bar: band === "NORMAL" ? "bg-amber" : "bg-alert", border: band === "NORMAL" ? "border-amber" : "border-alert" }
                  : act
                    ? { bar: "bg-amber", border: "border-amber/45" }
                    : { bar: "bg-ik-rule-strong", border: "border-ik-rule" };
                return (
                  <li
                    key={p.id}
                    className={
                      "relative flex flex-col overflow-hidden rounded-lg border bg-ik-card transition " +
                      "hover:shadow-[0_3px_18px_rgba(20,25,20,0.07)] " + a.border
                    }
                  >
                    <span className={"absolute inset-y-0 left-0 w-1 " + a.bar} aria-hidden />
                    <div className="flex h-full flex-col gap-2 p-4 pl-5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[12px] text-ik-ink-3">{p.poNo}</span>
                        <span className="font-mono text-[15px] font-bold text-ik-ink">{formatINRWhole(p.total)}</span>
                      </div>
                      {band && (
                        <div className="flex items-center gap-2">
                          <RevisedBadge band={band} />
                          <span className="text-[11.5px] font-semibold text-alert">Order changed — re-check</span>
                        </div>
                      )}
                      <div className="truncate text-[13.5px] font-medium text-ik-ink">{p.vendor}</div>
                      <div className="text-[12px] text-ik-ink-2">{PO_LABEL[p.status] ?? p.status}</div>
                      <Link href={`/procurement/purchase-orders/${p.id}`} className="mt-auto pt-1">
                        <Button variant={act ? "default" : "outline"} className="h-10 w-full">
                          {act ? "Open to act →" : "Open"}
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

/** Compact date-first request card — shared by the chef + F&B tabs, same
 *  language as the /requisitions grid: urgency rail, bold date hero, one
 *  full-width action. */
function ReqCard({
  href,
  reqNo,
  title,
  sub,
  eventDate,
  deliveryWindow = null,
  createdAt,
  revisedBand,
}: {
  href: string;
  reqNo: string;
  title: string;
  sub: string;
  eventDate: string | null;
  /** Order delivery window — the store issues to this clock. */
  deliveryWindow?: { start: string; end: string } | null;
  createdAt: string;
  /** Set when the order behind this request was changed after it was raised. */
  revisedBand?: RevisionBand;
}) {
  const prio = eventDate ? eventPriority(eventDate) : null;
  const target = eventDate ?? createdAt;
  const a = revisedBand
    ? {
        bar: revisedBand === "NORMAL" ? "bg-amber" : "bg-alert",
        border: revisedBand === "NORMAL" ? "border-amber" : "border-alert",
      }
    : accent(prio ? prio.days : null);
  return (
    <li
      className={
        "relative flex flex-col overflow-hidden rounded-lg border bg-ik-card transition " +
        "hover:shadow-[0_3px_18px_rgba(20,25,20,0.07)] " + a.border
      }
    >
      <span className={"absolute inset-y-0 left-0 w-1 " + a.bar} aria-hidden />
      <div className="flex h-full flex-col gap-3 p-4 pl-5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[12px] text-ik-ink-3">{reqNo}</span>
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            {revisedBand && <RevisedBadge band={revisedBand} />}
            {prio ? (
              <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide " + prio.cls}>
                {prio.label}
              </span>
            ) : (
              <span className="rounded-full bg-ik-paper-alt px-2 py-0.5 text-[10px] font-bold tracking-wide text-ik-ink-2 ring-1 ring-ik-rule">
                RAISED
              </span>
            )}
          </span>
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-bold leading-none tracking-tight text-ik-ink">
              {formatIST(new Date(target), "EEE d MMM")}
            </span>
            <span className="text-[13px] font-semibold text-ik-ink-2">
              {formatIST(new Date(target), "HH:mm")}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] font-medium">
            {prio ? <Countdown target={target} /> : <span className="text-ik-ink-3">Raised</span>}
          </div>
          {deliveryWindow && (
            <div className="mt-0.5 text-[11px] font-medium text-ik-ink-2">
              🕒 Window {formatIST(new Date(deliveryWindow.start), "HH:mm")}–{formatIST(new Date(deliveryWindow.end), "HH:mm")}
            </div>
          )}
        </div>
        <div className="border-t border-ik-rule pt-2.5">
          <div className="truncate text-[13px] font-medium text-ik-ink">{title}</div>
          <div className="mt-0.5 text-[12px] text-ik-ink-3">{sub}</div>
          {revisedBand && (
            <div className="mt-1 text-[12px] font-semibold text-alert">
              The order changed — check the Revised orders tab before you issue.
            </div>
          )}
        </div>
        <Link href={href} className="mt-auto" aria-label={`Open ${reqNo} to issue`}>
          <Button className="h-10 w-full">Open to issue →</Button>
        </Link>
      </div>
    </li>
  );
}
