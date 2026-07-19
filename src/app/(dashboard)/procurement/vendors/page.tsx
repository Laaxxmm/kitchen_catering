import Link from "next/link";
import { VendorApprovalStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listVendors } from "@/server/actions/vendors";

export const dynamic = "force-dynamic";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const sp = await searchParams;
  const includeInactive = sp.inactive === "1";
  const vendors = await listVendors({
    query: sp.q,
    active: includeInactive ? undefined : true,
  });

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Vendors"
        description="Supplier master. The state code drives GST split on every PO and bill."
        actions={<Link href="/procurement/vendors/new"><Button>New vendor</Button></Link>}
      />
      <form className="mb-4 flex gap-2" action="/procurement/vendors">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search name, code, GSTIN…"
          className="h-9 w-72 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <label className="flex items-center gap-1 text-[12px] text-ik-ink-2">
          <input type="checkbox" name="inactive" value="1" defaultChecked={includeInactive} />
          Include inactive
        </label>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>
      {vendors.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No vendors yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono text-[12px]">{v.code}</TableCell>
                <TableCell>
                  <Link href={`/procurement/vendors/${v.id}`} className="text-brand hover:underline">{v.name}</Link>
                </TableCell>
                <TableCell>{v.category}</TableCell>
                <TableCell className="font-mono text-[12px]">{v.gstin ?? "—"}</TableCell>
                <TableCell>{v.stateCode}</TableCell>
                <TableCell>{v.paymentTerms}</TableCell>
                <TableCell>
                  {!v.active ? (
                    <span className="text-ik-ink-3">Inactive</span>
                  ) : v.approvalStatus === VendorApprovalStatus.PENDING_APPROVAL ? (
                    <span className="text-gold">Pending approval</span>
                  ) : (
                    <span className="text-positive">Active</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
