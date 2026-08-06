"use client";

import Link from "next/link";
import { AlertTriangle, Wallet, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ik/StatusPill";
import { MarkPaidModal } from "@/components/ik/finance/MarkPaidModal";
import { formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { markVendorBillPaid } from "@/server/actions/procurement";
import { markCustomerInvoicePaid } from "@/server/actions/customer-invoices";

export interface PayBill {
  id: string;
  billNo: string;
  vendor: string;
  amount: string;
  due: string | null;
  overdue: boolean;
  /** Approved (or approved and past due). Anything else needs approving first. */
  payable: boolean;
}
export interface CollectInvoice {
  id: string;
  invoiceNo: string;
  customer: string;
  amount: string;
  due: string | null;
  overdue: boolean;
}
export interface Overpaid {
  id: string;
  invoiceNo: string;
  customer: string;
  total: string;
  paid: string;
}

interface Props {
  toPay: PayBill[];
  toCollect: CollectInvoice[];
  overpaid: Overpaid[];
  /** Admin/manager can close a customer invoice with the one-click modal;
   *  accounts records detailed receipts on the invoice page instead. */
  canMarkCustomerPaid: boolean;
}

export function PaymentsActionView({ toPay, toCollect, overpaid, canMarkCustomerPaid }: Props) {
  return (
    <div className="grid gap-5">
      {/* Duplicate / over-payment warning */}
      {overpaid.length > 0 && (
        <section className="rounded-md border border-alert/40 bg-alert-wash p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-alert">
            <AlertTriangle size={16} />
            {overpaid.length} {overpaid.length === 1 ? "invoice has" : "invoices have"} more recorded than the total
          </div>
          <ul className="mt-1.5 grid gap-1 text-[12px] text-ik-ink-2">
            {overpaid.map((o) => (
              <li key={o.id}>
                <Link href={`/invoices/${o.id}`} className="font-mono text-brand hover:underline">{o.invoiceNo}</Link>
                {" "}· {o.customer} · billed {formatINRWhole(o.total)}, recorded {formatINRWhole(o.paid)} — check for a duplicate payment.
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* To pay · vendors */}
      <section className="rounded-md border border-ik-rule bg-ik-card">
        <header className="flex items-center gap-2 border-b border-ik-rule px-3 py-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700"><Wallet size={16} /></span>
          <span className="text-[13px] font-semibold text-ik-ink">To pay · vendors</span>
          <span className="ml-auto text-[11.5px] text-ik-ink-3">{toPay.length} {toPay.length === 1 ? "bill" : "bills"}</span>
        </header>
        {toPay.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-ik-ink-2">No vendor bills to pay right now.</p>
        ) : (
          <ul className="divide-y divide-ik-rule">
            {toPay.map((b) => (
              <li key={b.id} className="flex min-h-[44px] flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-[13px] text-ik-ink"><strong>{b.vendor}</strong></span>
                <span className="font-mono text-[11.5px] text-ik-ink-3">{b.billNo}</span>
                {b.due && (b.overdue
                  ? <StatusPill tone="red">Overdue {formatIST(new Date(b.due), "d MMM")}</StatusPill>
                  : <span className="text-[11.5px] text-ik-ink-3">due {formatIST(new Date(b.due), "d MMM")}</span>)}
                <span className="ml-auto font-mono text-[13px] text-ik-ink">{formatINRWhole(b.amount)}</span>
                {/* Payment waits on the accounts approval — offer that step
                    rather than a button the action would refuse. */}
                {b.payable ? (
                  <MarkPaidModal
                    outstanding={b.amount}
                    onSubmit={(input) =>
                      markVendorBillPaid({ id: b.id, method: input.method, reference: input.reference, paidAt: input.paidAt, notes: input.notes })
                    }
                  />
                ) : (
                  <Link href={`/procurement/vendor-bills/${b.id}`}>
                    <Button size="sm" variant="outline">Approve first</Button>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* To collect · customers */}
      <section className="rounded-md border border-ik-rule bg-ik-card">
        <header className="flex items-center gap-2 border-b border-ik-rule px-3 py-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700"><HandCoins size={16} /></span>
          <span className="text-[13px] font-semibold text-ik-ink">To collect · customers</span>
          <span className="ml-auto text-[11.5px] text-ik-ink-3">{toCollect.length} {toCollect.length === 1 ? "invoice" : "invoices"}</span>
        </header>
        {toCollect.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-ik-ink-2">Nothing outstanding from customers.</p>
        ) : (
          <ul className="divide-y divide-ik-rule">
            {toCollect.map((inv) => (
              <li key={inv.id} className="flex min-h-[44px] flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-[13px] text-ik-ink"><strong>{inv.customer}</strong></span>
                <span className="font-mono text-[11.5px] text-ik-ink-3">{inv.invoiceNo}</span>
                {inv.due && (inv.overdue
                  ? <StatusPill tone="red">Overdue {formatIST(new Date(inv.due), "d MMM")}</StatusPill>
                  : <span className="text-[11.5px] text-ik-ink-3">due {formatIST(new Date(inv.due), "d MMM")}</span>)}
                <span className="ml-auto font-mono text-[13px] text-ik-ink">{formatINRWhole(inv.amount)}</span>
                {canMarkCustomerPaid ? (
                  <MarkPaidModal
                    outstanding={inv.amount}
                    onSubmit={(input) =>
                      markCustomerInvoicePaid({
                        invoiceId: inv.id,
                        method: input.method,
                        reference: input.reference,
                        paidAt: input.paidAt,
                        notes: input.notes,
                      })
                    }
                  />
                ) : (
                  <Link href={`/invoices/${inv.id}`}>
                    <Button size="sm" variant="outline">Record</Button>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recorded payments — reference history */}
      <section>
        <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Recorded payments</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/payments/receivables"><Button size="sm" variant="outline">Money received (AR)</Button></Link>
          <Link href="/payments/payables"><Button size="sm" variant="outline">Money paid (AP)</Button></Link>
        </div>
      </section>
    </div>
  );
}
