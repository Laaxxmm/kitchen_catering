import Link from "next/link";
import { notFound } from "next/navigation";
import { Role, VendorApprovalStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";
import { approveVendor, deactivateVendor, getVendor, updateVendor } from "@/server/actions/vendors";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { listVendorPOs } from "@/server/actions/procurement";
import { VendorForm } from "../_components/VendorForm";
import { VendorHistoryPanel } from "./_components/VendorHistoryPanel";
import { VendorOrders } from "./_components/VendorOrders";
import { DetailTabs } from "@/components/ik/DetailTabs";
import type { VendorInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [vendor, pos, session] = await Promise.all([
    getVendor(id),
    listVendorPOs({ vendorId: id }),
    auth(),
  ]);
  if (!vendor) notFound();

  const role = session?.user?.role as Role | undefined;
  const canApprove = role === Role.ADMIN || role === Role.MANAGER;
  const isPending = vendor.approvalStatus === VendorApprovalStatus.PENDING_APPROVAL;

  async function update(input: VendorInputT) {
    "use server";
    const r = await updateVendor(id, input);
    if (!r.ok) return r;
    return { ok: true as const, id };
  }
  async function deactivate() {
    "use server";
    return await deactivateVendor(id);
  }
  async function approve() {
    "use server";
    return await approveVendor(id);
  }

  return (
    <>
      <PageHeader
        eyebrow={`Vendor · ${vendor.code}`}
        title={vendor.name}
        description={vendor.gstin ?? "No GSTIN on file"}
        actions={
          <div className="flex gap-2">
            <Link href="/procurement/vendors"><Button variant="outline">Back</Button></Link>
            {isPending && canApprove && (
              <ActionResultButton action={approve} successMessage="Vendor approved — POs can now be raised">
                Approve vendor
              </ActionResultButton>
            )}
            {vendor.active && (
              <ActionResultButton action={deactivate} variant="outline" successMessage="Vendor deactivated">
                Deactivate
              </ActionResultButton>
            )}
          </div>
        }
      />
      {/* The approve control lives IN the banner, not only in the header
          actions — a manager reading "needs an admin or manager's approval"
          must be able to act on it right there. Non-approvers get the same
          banner minus the button, so nobody is left at a dead end. */}
      {isPending && (
        <div className="mb-4 rounded-md border border-amber bg-amber-wash p-3 text-[13px] text-amber-700">
          <strong>Pending approval:</strong> this supplier was added by the store, and an admin or
          manager must approve them before purchase orders can be raised on them.
          {canApprove ? (
            <div className="mt-3">
              <ActionResultButton action={approve} successMessage="Vendor approved — POs can now be raised">
                Approve vendor
              </ActionResultButton>
            </div>
          ) : (
            <div className="mt-2">
              An admin and manager have already been notified. As soon as one of them approves, your
              purchase order on this supplier can be submitted — the draft stays saved until then.
            </div>
          )}
        </div>
      )}
      <DetailTabs
        tabs={[
          {
            key: "details",
            label: "Details",
            content: (
              <VendorForm
                defaults={{
                  name: vendor.name, gstin: vendor.gstin, pan: vendor.pan, stateCode: vendor.stateCode,
                  category: vendor.category, msme: vendor.msme, contactName: vendor.contactName,
                  phone: vendor.phone, email: vendor.email, address: vendor.address,
                  paymentTerms: vendor.paymentTerms, notes: vendor.notes,
                }}
                onSubmit={update}
                submitLabel="Save changes"
              />
            ),
          },
          {
            key: "pos",
            label: "Purchase orders",
            count: pos.length,
            content: (
              <VendorOrders
                pos={pos.map((p) => ({
                  id: p.id,
                  poNo: p.poNo,
                  issueDate: p.issueDate.toISOString(),
                  status: p.status,
                  grandTotal: p.grandTotal.toString(),
                  orderCode: p.order?.code ?? null,
                }))}
              />
            ),
          },
          {
            key: "history",
            label: "Bills & payments",
            content: <VendorHistoryPanel vendorId={id} />,
          },
        ]}
      />
    </>
  );
}
