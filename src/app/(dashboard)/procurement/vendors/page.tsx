import Link from "next/link";
import { Role, VendorApprovalStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/ik/StatusPill";
import { auth } from "@/server/auth";
import { listPendingVendors, listVendors } from "@/server/actions/vendors";

export const dynamic = "force-dynamic";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string; pending?: string }>;
}) {
  const sp = await searchParams;
  const includeInactive = sp.inactive === "1";
  const pendingOnly = sp.pending === "1";
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const canApprove = role === Role.ADMIN || role === Role.MANAGER;
  const [vendors, pending] = await Promise.all([
    listVendors({
      query: sp.q,
      active: includeInactive ? undefined : true,
      pendingOnly,
    }),
    // Whole-table count so the chip stays honest while a search is applied.
    // Role-gated, so only fetch it for the roles that can act on it.
    canApprove ? listPendingVendors() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Vendors"
        description="Supplier master. The state code drives GST split on every PO and bill."
        actions={<Link href="/procurement/vendors/new"><Button>New vendor</Button></Link>}
      />
      <form className="mb-4 flex flex-wrap items-center gap-2" action="/procurement/vendors">
        {pendingOnly && <input type="hidden" name="pending" value="1" />}
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
        {/* Toggles the pending-only view. Shown while the filter is on even at
            zero, so the last approval doesn't strand the page on an empty list. */}
        {canApprove && (pending.length > 0 || pendingOnly) && (
          <Link
            href={pendingOnly ? "/procurement/vendors" : "/procurement/vendors?pending=1"}
            className={
              "ml-1 rounded-full px-3 py-1 text-[12px] font-medium " +
              (pendingOnly
                ? "bg-amber text-white"
                : "bg-amber-wash text-amber-700 hover:bg-amber hover:text-white")
            }
          >
            Pending approval · {pending.length}
          </Link>
        )}
      </form>
      {vendors.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          {pendingOnly ? "No suppliers are waiting for approval." : "No vendors yet."}
        </p>
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
                    <StatusPill tone="grey">Inactive</StatusPill>
                  ) : v.approvalStatus === VendorApprovalStatus.PENDING_APPROVAL ? (
                    <StatusPill tone="amber">Pending approval</StatusPill>
                  ) : (
                    <StatusPill tone="green">Active</StatusPill>
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
