"use client";

import Link from "next/link";
import { VendorBillStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { WorkTabs } from "@/components/ik/dashboard/WorkTabs";
import { CappedList } from "@/components/ik/dashboard/CappedList";
import { MarkPaidModal } from "@/components/ik/finance/MarkPaidModal";
import { SummaryStrip } from "@/components/ik/StatChips";
import { formatINR, formatINRWhole } from "@/lib/money";
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
  status: VendorBillStatus;
  /** Approved (or overdue, i.e. approved and late). Anything else can't be paid yet. */
  payable: boolean;
}

/**
 * Accounts board: money to collect (customer invoices with a balance), bills
 * that are waiting on someone here to match/approve them, and money to pay,
 * each with "Mark paid" inline via the same modal used on the detail pages.
 * No drilling in to settle routine payments.
 */
export function AccountsBoard({ receivables, payables }: { receivables: Receivable[]; payables: Payable[] }) {
  // A MATCHED or DISCREPANCY bill isn't "to pay" — it's blocked on a human
  // at this desk. It used to sit in the pay tab behind an "Approve first"
  // button, indistinguishable from a bill that was simply awaiting cash.
  const review = payables.filter((p) => !p.payable);
  const toPayNow = payables.filter((p) => p.payable);

  const tabs = [
    { key: "collect", label: "To collect", hint: "Customer invoices", count: receivables.length },
    { key: "review", label: "Needs review", hint: "Match / approve first", count: review.length },
    { key: "pay", label: "To pay", hint: "Approved vendor bills", count: toPayNow.length },
  ];

  // No due date on these rows — largest balance is the urgency signal.
  const recSorted = [...receivables].sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  const paySorted = [...toPayNow].sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  // Failed matches first: they need correcting, not just a signature.
  const reviewSorted = [...review].sort(
    (a, b) =>
      Number(isDiscrepancy(b)) - Number(isDiscrepancy(a)) ||
      Number(b.outstanding) - Number(a.outstanding),
  );

  const toCollect = receivables.reduce((s, r) => s + Number(r.outstanding), 0);
  const toPay = payables.reduce((s, p) => s + Number(p.outstanding), 0);
  const mismatched = review.filter(isDiscrepancy).length;

  return (
    <div>
      <div className="mb-4">
        <SummaryStrip
          chips={[
            { label: "To collect", value: formatINRWhole(toCollect), tone: toCollect > 0 ? "green" : "grey" },
            { label: "To pay", value: formatINRWhole(toPay), tone: toPay > 0 ? "red" : "grey" },
            { label: "Invoices", value: receivables.length },
            {
              label: mismatched > 0 ? "Bills · mismatched" : "Bills",
              value: mismatched > 0 ? `${payables.length} · ${mismatched}` : payables.length,
              tone: mismatched > 0 ? "amber" : undefined,
            },
          ]}
        />
      </div>
      <WorkTabs tabs={tabs} emptyHint="Nothing in {tab} right now.">
      {(active) =>
        active === "collect" ? (
          <CappedList items={recSorted} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" keyOf={(r) => r.id}>
            {(r) => (
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
            )}
          </CappedList>
        ) : (
          <CappedList
            items={active === "review" ? reviewSorted : paySorted}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            keyOf={(p) => p.id}
          >
            {(p) => <BillCard key={p.id} bill={p} />}
          </CappedList>
        )
      }
      </WorkTabs>
    </div>
  );
}

function isDiscrepancy(p: Payable): boolean {
  return p.status === VendorBillStatus.DISCREPANCY;
}

function BillCard({ bill: p }: { bill: Payable }) {
  const failed = isDiscrepancy(p);
  return (
    <li className={"rounded-md border bg-ik-card p-3 " + (failed ? "border-amber" : "border-ik-rule")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[12.5px] text-brand-700">{p.billNo}</span>
        <span className="font-mono text-[13px] text-ik-ink">{formatINR(p.outstanding)}</span>
      </div>
      <div className="mt-1 text-[13px] text-ik-ink"><strong>{p.vendorName}</strong></div>
      {/* Say which kind of "not yet payable" this is — an unsigned match and a
          failed one need completely different work. */}
      {!p.payable && (
        <p className={"mt-1 text-[11.5px] " + (failed ? "text-amber-700" : "text-ik-ink-3")}>
          {failed
            ? "Failed the 3-way match — correct the amounts or approve with a written reason."
            : "Matched the PO — approve it and it becomes payable."}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        {/* Nothing is payable before accounts approve it — offer the
            approval step instead of a button that would be refused. */}
        {p.payable ? (
          <MarkPaidModal
            outstanding={p.outstanding}
            onSubmit={(input) =>
              markVendorBillPaid({
                id: p.id,
                method: input.method,
                reference: input.reference,
                paidAt: input.paidAt,
                notes: input.notes,
              })
            }
          />
        ) : (
          <Link href={`/procurement/vendor-bills/${p.id}`}>
            <Button size="sm" variant={failed ? "default" : "outline"}>
              {failed ? "Fix the mismatch" : "Approve first"}
            </Button>
          </Link>
        )}
        <Link href={`/procurement/vendor-bills/${p.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Open</Link>
      </div>
    </li>
  );
}
