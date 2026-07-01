import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { deactivateVendor, getVendor, updateVendor } from "@/server/actions/vendors";
import { listVendorPOs } from "@/server/actions/procurement";
import { VendorForm } from "../_components/VendorForm";
import { VendorHistoryPanel } from "./_components/VendorHistoryPanel";
import { VendorOrders } from "./_components/VendorOrders";
import { DetailTabs } from "@/components/ik/DetailTabs";
import type { VendorInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [vendor, pos] = await Promise.all([getVendor(id), listVendorPOs({ vendorId: id })]);
  if (!vendor) notFound();

  async function update(input: VendorInputT) {
    "use server";
    await updateVendor(id, input);
    return { id };
  }
  async function deactivate() {
    "use server";
    await deactivateVendor(id);
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
            {vendor.active && (
              <form action={deactivate}><Button type="submit" variant="outline">Deactivate</Button></form>
            )}
          </div>
        }
      />
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
