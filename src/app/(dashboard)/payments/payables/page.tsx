import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPayablePayments } from "@/server/actions/payments";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function PayablesPage() {
  const payments = await listPayablePayments(200);
  return (
    <>
      <PageHeader
        eyebrow="Finance · Payments"
        title="Payables — vendor payouts"
        description="Vendor bill payments. Record from the vendor bill detail page once the bill is APPROVED."
      />
      <div className="mb-4 flex gap-2 text-[12.5px]">
        <Link href="/payments/receivables" className="rounded-full bg-ik-paper-alt px-3 py-1 text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700">AR (customers)</Link>
        <Link href="/payments/payables" className="rounded-full bg-brand-500 px-3 py-1 text-white">AP (vendors)</Link>
      </div>
      {payments.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No vendor payments yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paid at</TableHead>
              <TableHead>Bill</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Recorded by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-[12px]">{formatIST(p.paidAt, "yyyy-MM-dd")}</TableCell>
                <TableCell>
                  <Link href={`/procurement/vendor-bills/${p.vendorBill.id}`} className="font-mono text-brand hover:underline">
                    {p.vendorBill.billNo}
                  </Link>
                </TableCell>
                <TableCell>{p.vendorBill.vendor.name}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(p.amount)}</TableCell>
                <TableCell>{p.method}</TableCell>
                <TableCell className="font-mono text-[12px]">{p.reference ?? "—"}</TableCell>
                <TableCell>{p.recordedBy?.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
