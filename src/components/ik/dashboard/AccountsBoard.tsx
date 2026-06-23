"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WorkTabs } from "@/components/ik/dashboard/WorkTabs";
import { MarkPaidModal } from "@/components/ik/finance/MarkPaidModal";
import { formatINR } from "@/lib/money";
import { markVendorBillPaid } from "@/server/actions/procurement";

export interface Receivable {
  id: string;
  invoiceNo: string;
  customerName: string;
  orderCode: string | null;
  outstanding: string;
}
export interface Payable {
  id: string;
  billNo: string;
  vendorName: string;
  outstanding: string;
}

/**
 * Accounts board: money to collect (customer invoices with a balance) and
 * money to pay (vendor bills with a balance), each with "Mark paid" inline
 * via the same modal used on the detail pages. No drilling in to settle
 * routine payments.
 */
export function AccountsBoard({ receivables, payables }: { receivables: Receivable[]; payables: Payable[] }) {
  const tabs = [
    { key: "collect", label: "To collect", hint: "Customer invoices", count: receivables.length },
    { key: "pay", label: "To pay", hint: "Vendor bills", count: payables.length },
  ];

  return (
    <WorkTabs tabs={tabs} emptyHint="Nothing in {tab} right now.">
      {(active) =>
        active === "collect" ? (
          <ul className="grid gap-2.5">
            {receivables.map((r) => (
              <li key={r.id} className="rounded-md border border-ik-rule bg-ik-card p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12.5px] text-brand-700">{r.invoiceNo}</span>
                  <span className="font-mono text-[13px] text-ik-ink">{formatINR(r.outstanding)}</span>
                </div>
                <div className="mt-1 text-[13px] text-ik-ink">
                  <strong>{r.customerName}</strong>
                  {r.orderCode && <span className="text-ik-ink-3"> · order {r.orderCode}</span>}
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  {/* Accounts records receivable payments through the
                      invoice's Record-payment form (TDS / part-payment /
                      reference capture); the one-click mark-paid is reserved
                      for admin/manager. So this opens the invoice. */}
                  <Link href={`/invoices/${r.id}`}>
                    <Button size="sm">Record payment</Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="grid gap-2.5">
            {payables.map((p) => (
              <li key={p.id} className="rounded-md border border-ik-rule bg-ik-card p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12.5px] text-brand-700">{p.billNo}</span>
                  <span className="font-mono text-[13px] text-ik-ink">{formatINR(p.outstanding)}</span>
                </div>
                <div className="mt-1 text-[13px] text-ik-ink"><strong>{p.vendorName}</strong></div>
                <div className="mt-2.5 flex items-center gap-2">
                  <MarkPaidModal
                    outstanding={p.outstanding}
                    onSubmit={async (input) => {
                      await markVendorBillPaid({
                        id: p.id,
                        method: input.method,
                        reference: input.reference,
                        paidAt: input.paidAt,
                        notes: input.notes,
                      });
                    }}
                  />
                  <Link href={`/procurement/vendor-bills/${p.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Open</Link>
                </div>
              </li>
            ))}
          </ul>
        )
      }
    </WorkTabs>
  );
}
