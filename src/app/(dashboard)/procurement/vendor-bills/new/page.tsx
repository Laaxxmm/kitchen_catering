import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { listVendors } from "@/server/actions/vendors";
import { listVendorPOs, createVendorBill } from "@/server/actions/procurement";
import { VendorPOStatus } from "@prisma/client";
import { VendorBillForm } from "./_components/VendorBillForm";

export const dynamic = "force-dynamic";

export default async function NewVendorBillPage() {
  const [vendors, pos] = await Promise.all([
    listVendors({ active: true }),
    listVendorPOs({ status: [VendorPOStatus.PARTIALLY_RECEIVED, VendorPOStatus.RECEIVED, VendorPOStatus.SENT, VendorPOStatus.APPROVED] }),
  ]);

  async function create(input: {
    vendorId: string; poId: string | null; vendorBillNo: string | null;
    issueDate: string | undefined; dueDate: string | null; notes: string | null;
    lines: Array<{ description: string; quantity: string; unit: string; unitPrice: string; gstRatePct: string }>;
  }) {
    "use server";
    const r = await createVendorBill(input);
    redirect(`/procurement/vendor-bills/${r.id}`);
  }

  return (
    <>
      <PageHeader eyebrow="Procurement" title="New vendor bill" description="Capture vendor's invoice. After saving, click Match to run 3-way match against the linked PO + GRN." />
      <VendorBillForm
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, code: v.code }))}
        pos={pos.map((p) => ({ id: p.id, poNo: p.poNo, vendorId: p.vendorId, vendorName: p.vendor.name }))}
        onSubmit={create}
      />
    </>
  );
}
