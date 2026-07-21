import Link from "next/link";
import { Role, VendorBillStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { auth } from "@/server/auth";
import { listVendorBills } from "@/server/actions/procurement";
import { listVendors } from "@/server/actions/vendors";
import { formatINR } from "@/lib/money";


export const dynamic = "force-dynamic";

export default async function VendorBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendorId?: string }>;
}) {
  const sp = await searchParams;
  const vendorId = sp.vendorId || undefined;
  const [session, bills, vendors] = await Promise.all([
    auth(),
    listVendorBills({ vendorId }),
    listVendors({ active: true }),
  ]);
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
        actions={canMark ? <Link href="/procurement/vendor-bills/new"><Button>New bill</Button></Link> : undefined}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="vendorId" className="text-[11.5px] text-ik-ink-3">Filter by vendor</label>
          <select id="vendorId" name="vendorId" defaultValue={vendorId ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}
          </select>
        </div>
        <Button type="submit" variant="outline">Filter</Button>
        {vendorId && <Link href="/procurement/vendor-bills"><Button type="button" variant="ghost">Clear</Button></Link>}
      </form>
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
              <TableHead>Order</TableHead>
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
              // Inline list-row mark-paid removed in Phase 1 — full
              // capture (ref / method / date) needs the modal on the
              // detail page.
              return (
                <TableRow key={b.id}>
                  <TableCell><Link href={`/procurement/vendor-bills/${b.id}`} className="font-mono text-brand hover:underline">{b.billNo}</Link></TableCell>
                  <TableCell className="font-mono text-[12px]">{b.vendorBillNo ?? "—"}</TableCell>
                  <TableCell>
                    <Link href={`/procurement/vendors/${b.vendor.id}`} className="text-brand hover:underline">
                      {b.vendor.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-[12px]">{b.po?.poNo ?? "—"}</TableCell>
                  <TableCell className="font-mono text-[12px]">{b.po?.order?.code ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(b.grandTotal)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(b.amountPaid)}</TableCell>
                  <TableCell><StatusBadge status={b.status} /></TableCell>
                  {canMark && (
                    <TableCell>
                      {eligible ? (
                        <Link href={`/procurement/vendor-bills/${b.id}`}>
                          <Button type="button" size="sm" variant="outline">
                            Mark paid…
                          </Button>
                        </Link>
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
