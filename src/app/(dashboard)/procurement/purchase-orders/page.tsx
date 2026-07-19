import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listVendorPOs } from "@/server/actions/procurement";
import { listVendors } from "@/server/actions/vendors";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function VendorPOsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendorId?: string }>;
}) {
  const sp = await searchParams;
  const vendorId = sp.vendorId || undefined;
  const [pos, vendors] = await Promise.all([
    listVendorPOs({ vendorId }),
    listVendors({ active: true }),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Vendor POs"
        description="Approval by value: under ₹5,000 the Manager signs off; ₹5,000 and above needs Admin."
        actions={
          <div className="flex flex-wrap gap-2">
            <a href="/api/export/purchase-orders"><Button variant="outline">Download Excel</Button></a>
            <Link href="/procurement/purchase-orders/new"><Button>New PO</Button></Link>
          </div>
        }
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
        {vendorId && <Link href="/procurement/purchase-orders"><Button type="button" variant="ghost">Clear</Button></Link>}
      </form>
      {pos.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No POs yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO no</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pos.map((po) => (
              <TableRow key={po.id}>
                <TableCell><Link href={`/procurement/purchase-orders/${po.id}`} className="font-mono text-brand hover:underline">{po.poNo}</Link></TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(po.issueDate, "yyyy-MM-dd")}</TableCell>
                <TableCell>{po.vendor.name} <span className="text-ik-ink-3">· {po.vendor.code}</span></TableCell>
                <TableCell>{po.approvalTier}</TableCell>
                <TableCell className="text-right">{po._count.lines}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(po.grandTotal)}</TableCell>
                <TableCell><StatusBadge status={po.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
