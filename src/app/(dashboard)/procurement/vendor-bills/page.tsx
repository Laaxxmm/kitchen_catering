import Link from "next/link";
import { Role, VendorBillStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { auth } from "@/server/auth";
import { listVendorBills, markVendorBillPaid } from "@/server/actions/procurement";
import { formatINR } from "@/lib/money";


export const dynamic = "force-dynamic";

export default async function VendorBillsPage() {
  const [session, bills] = await Promise.all([auth(), listVendorBills()]);
  const role = session?.user?.role;
  // Vendor side: accounts pays the suppliers, so admin / manager /
  // accounts all get the one-click mark-paid here. (Customer-side
  // mark-paid in /invoices is still admin/manager only — that gate is
  // managed inside markCustomerInvoicePaid.)
  const canMark = role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS;
  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Vendor bills"
        description="Bills from suppliers. 3-way match (bill ↔ PO ↔ GRN), then approve and mark paid when the payment goes out."
        actions={<Link href="/procurement/vendor-bills/new"><Button>New bill</Button></Link>}
      />
      {bills.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No vendor bills yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill no</TableHead>
              <TableHead>Vendor bill #</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>PO</TableHead>
              <TableHead className="text-right">Grand total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Status</TableHead>
              {canMark && <TableHead>Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((b) => {
              const eligible =
                canMark &&
                b.status !== VendorBillStatus.PAID &&
                b.status !== VendorBillStatus.DRAFT &&
                b.status !== VendorBillStatus.PENDING_MATCH;
              async function markPaid() {
                "use server";
                await markVendorBillPaid(b.id);
              }
              return (
                <TableRow key={b.id}>
                  <TableCell><Link href={`/procurement/vendor-bills/${b.id}`} className="font-mono text-brand hover:underline">{b.billNo}</Link></TableCell>
                  <TableCell className="font-mono text-[12px]">{b.vendorBillNo ?? "—"}</TableCell>
                  <TableCell>{b.vendor.name}</TableCell>
                  <TableCell className="font-mono text-[12px]">{b.po?.poNo ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(b.grandTotal)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(b.amountPaid)}</TableCell>
                  <TableCell><StatusBadge status={b.status} /></TableCell>
                  {canMark && (
                    <TableCell>
                      {eligible ? (
                        <form action={markPaid}>
                          <Button type="submit" size="sm" variant="outline">Mark paid</Button>
                        </form>
                      ) : (
                        <span className="text-[12px] text-ik-ink-3">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
