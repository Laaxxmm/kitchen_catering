import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { getVendorHistory } from "@/server/actions/vendors";

/**
 * Server component: per-vendor activity timeline + summary totals.
 * Each event row shows the running outstanding AFTER the event.
 */
export async function VendorHistoryPanel({ vendorId }: { vendorId: string }) {
  const { timeline, totals } = await getVendorHistory(vendorId);

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <h3 className="font-medium text-[14px] text-ik-ink">History</h3>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
          <Summary label="Total billed" value={totals.billed} tone="neutral" />
          <Summary label="Total paid" value={totals.paid} tone="positive" />
          <Summary
            label="Outstanding"
            value={totals.outstanding}
            tone={Number(totals.outstanding) > 0 ? "alert" : "neutral"}
          />
        </div>
      </div>
      {timeline.length === 0 ? (
        <p className="text-[12.5px] text-ik-ink-3">
          No bills or payments recorded against this vendor yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Outstanding after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {timeline.map((e) => {
              if (e.kind === "BILL") {
                return (
                  <TableRow key={`bill-${e.id}`}>
                    <TableCell className="font-mono text-[12px]">
                      {formatIST(e.occurredAt, "yyyy-MM-dd")}
                    </TableCell>
                    <TableCell>
                      <span className="text-[11.5px] font-medium uppercase tracking-wide text-ik-ink-2">
                        Bill
                      </span>
                    </TableCell>
                    <TableCell className="text-[12.5px]">
                      <Link
                        href={`/procurement/vendor-bills/${e.id}`}
                        className="font-mono text-brand hover:underline"
                      >
                        {e.billNo}
                      </Link>
                      {e.vendorBillNo && (
                        <span className="ml-2 text-ik-ink-3">
                          (vendor #{e.vendorBillNo})
                        </span>
                      )}
                      <span className="ml-2 text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                        {e.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatINR(e.grandTotal)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatINR(e.runningOutstanding)}
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <TableRow key={`pay-${e.id}`}>
                  <TableCell className="font-mono text-[12px]">
                    {formatIST(e.occurredAt, "yyyy-MM-dd")}
                  </TableCell>
                  <TableCell>
                    <span className="text-[11.5px] font-medium uppercase tracking-wide text-positive">
                      Payment
                    </span>
                  </TableCell>
                  <TableCell className="text-[12.5px]">
                    against <span className="font-mono">{e.billNo}</span> ·{" "}
                    {e.method}
                    {e.reference && (
                      <span className="ml-1 font-mono text-[11px] text-ik-ink-3">
                        ref {e.reference}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-positive">
                    -{formatINR(e.amount)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatINR(e.runningOutstanding)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "positive" | "alert";
}) {
  const colour =
    tone === "alert"
      ? "text-alert"
      : tone === "positive"
        ? "text-positive"
        : "text-ik-ink";
  return (
    <span className="text-ik-ink-3">
      {label}:{" "}
      <span className={`font-mono ${colour}`}>{formatINR(value)}</span>
    </span>
  );
}
