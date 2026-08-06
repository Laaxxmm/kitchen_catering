"use client";

import Link from "next/link";
import { CheckCheck, Wallet, Package, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ik/StatusPill";
import { MarkPaidModal } from "@/components/ik/finance/MarkPaidModal";
import { formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { markVendorBillPaid } from "@/server/actions/procurement";

export interface Worklist {
  billsToMatch: { id: string; billNo: string; vendor: string; amount: string }[];
  billsToPay: { id: string; billNo: string; vendor: string; amount: string; due: string | null; overdue: boolean; payable: boolean }[];
  lowStock: { id: string; name: string; unit: string; onHand: string; reorderLevel: string; out: boolean }[];
  total: number;
}

export function ReviewWorklist({ data }: { data: Worklist }) {
  if (data.total === 0) {
    return (
      <section className="flex items-center gap-3 rounded-md border border-positive/30 bg-positive/5 p-5">
        <CheckCircle2 size={22} className="text-positive" />
        <div className="text-[15px] font-medium text-ik-ink">You&apos;re all caught up.</div>
      </section>
    );
  }

  return (
    <div className="grid gap-4">
      {data.billsToMatch.length > 0 && (
        <GroupCard icon={<CheckCheck size={16} />} label="3-way match" count={data.billsToMatch.length}>
          {data.billsToMatch.map((b) => (
            <Row key={b.id}>
              <div>
                <span className="font-mono text-[12.5px] text-brand-700">{b.billNo}</span>
                <span className="ml-2 text-[12.5px] text-ik-ink"><strong>{b.vendor}</strong></span>
                <span className="ml-2 text-[12.5px] text-ik-ink-2">{formatINRWhole(b.amount)}</span>
              </div>
              <Link href={`/procurement/vendor-bills/${b.id}`} className="ml-auto">
                <Button size="sm" variant="outline">Match</Button>
              </Link>
            </Row>
          ))}
        </GroupCard>
      )}

      {data.billsToPay.length > 0 && (
        <GroupCard icon={<Wallet size={16} />} label="Pay supplier" count={data.billsToPay.length}>
          {data.billsToPay.map((b) => (
            <Row key={b.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[12.5px] text-brand-700">{b.billNo}</span>
                <span className="text-[12.5px] text-ik-ink"><strong>{b.vendor}</strong></span>
                <span className="text-[12.5px] text-ik-ink-2">{formatINRWhole(b.amount)}</span>
                {b.due && (
                  b.overdue
                    ? <StatusPill tone="red">Overdue {formatIST(new Date(b.due), "d MMM")}</StatusPill>
                    : <span className="text-[11.5px] text-ik-ink-3">due {formatIST(new Date(b.due), "d MMM")}</span>
                )}
              </div>
              <div className="ml-auto">
                {/* Approval comes first — a bill nobody has signed off can't
                    be paid, so send them to the bill instead. */}
                {b.payable ? (
                  <MarkPaidModal
                    outstanding={b.amount}
                    onSubmit={(input) =>
                      markVendorBillPaid({
                        id: b.id,
                        method: input.method,
                        reference: input.reference,
                        paidAt: input.paidAt,
                        notes: input.notes,
                      })
                    }
                  />
                ) : (
                  <Link href={`/procurement/vendor-bills/${b.id}`}>
                    <Button size="sm" variant="outline">Approve first</Button>
                  </Link>
                )}
              </div>
            </Row>
          ))}
        </GroupCard>
      )}

      {data.lowStock.length > 0 && <ReorderCard items={data.lowStock} />}
    </div>
  );
}

function GroupCard({ icon, label, count, children }: { icon: React.ReactNode; label: string; count: number; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-ik-rule bg-ik-card">
      <header className="flex items-center gap-2 border-b border-ik-rule px-3 py-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700">{icon}</span>
        <span className="text-[13px] font-semibold text-ik-ink">{label}</span>
        <span className="ml-auto rounded-full bg-alert-wash px-2 py-0.5 font-mono text-[11px] font-bold text-alert">{count}</span>
      </header>
      <ul className="divide-y divide-ik-rule">{children}</ul>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex min-h-[44px] flex-wrap items-center gap-2 px-3 py-2">{children}</li>;
}

function ReorderCard({ items }: { items: Worklist["lowStock"] }) {
  const shown = items.slice(0, 8);
  const extra = items.length - shown.length;

  return (
    <section className="rounded-md border border-ik-rule bg-ik-card">
      <header className="flex items-center gap-2 border-b border-ik-rule px-3 py-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700"><Package size={16} /></span>
        <span className="text-[13px] font-semibold text-ik-ink">Reorder ingredients</span>
        <span className="ml-auto rounded-full bg-alert-wash px-2 py-0.5 font-mono text-[11px] font-bold text-alert">{items.length}</span>
      </header>
      <div className="p-3">
        <div className="flex flex-wrap gap-1.5">
          {shown.map((i) => (
            <StatusPill key={i.id} tone={i.out ? "red" : "amber"}>
              {i.name} · {i.onHand} {i.unit}
            </StatusPill>
          ))}
          {extra > 0 && <span className="self-center text-[11.5px] text-ik-ink-3">+{extra} more</span>}
        </div>
        <div className="mt-3">
          <Link href="/procurement/purchase-orders/new?lowstock=1">
            <Button size="sm">Raise purchase order for all {items.length}</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
